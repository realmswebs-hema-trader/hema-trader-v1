import React, { useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  MessageCircle,
  MessageSquare,
  Package,
  Scale,
  Send,
  ShieldCheck,
  Smartphone,
  Truck
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import RatingModal from '../components/trade/RatingModal';
import DriverRatingModal from '../components/trade/DriverRatingModal';
import { findOptimalDrivers } from '../services/matchingService';

declare global {
  interface Window {
    FlutterwaveCheckout?: (options: any) => void;
  }
}

const OperationType = {
  READ: 'read',
  WRITE: 'write',
  UPDATE: 'update',
  DELETE: 'delete',
  SUBSCRIBE: 'subscribe'
} as const;

type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

const handleFirestoreError = (
  error: unknown,
  operation: OperationTypeValue,
  location: string
): string => {
  if (error instanceof FirebaseError) {
    console.error(`Firestore ${operation} failed at ${location}:`, {
      code: error.code,
      message: error.message
    });

    switch (error.code) {
      case 'permission-denied':
        return 'You do not have permission to perform this action.';
      case 'unauthenticated':
        return 'Please sign in before continuing.';
      case 'not-found':
        return 'The requested record could not be found.';
      case 'unavailable':
        return 'The database is temporarily unavailable. Please try again.';
      default:
        return error.message || 'A database error occurred.';
    }
  }

  if (error instanceof Error) {
    console.error(`Firestore ${operation} failed at ${location}:`, error);
    return error.message;
  }

  console.error(`Firestore ${operation} failed at ${location}:`, error);
  return 'Something went wrong. Please try again.';
};

const formatMessageTime = (value: any) => {
  const date =
    typeof value?.toDate === 'function'
      ? value.toDate()
      : value instanceof Date
        ? value
        : null;

  return date
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
};

interface Trade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: 'pending' | 'funded' | 'shipped' | 'completed' | 'disputed' | 'cancelled';
  createdAt: any;
  platformFee?: number;
  deliveryFee?: number;
  driverId?: string;
  driverCommission?: number;
  deliveryStatus?: string;
  deliveryETA?: string;
  deliveryRequestStatus?: string;
}

interface Listing {
  title: string;
  quantity: string;
  category: string;
  images: string[];
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: any;
}

interface Offer {
  id: string;
  senderId: string;
  amount: number;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: any;
}

interface AppProfile {
  displayName?: string;
  name?: string;
  phoneNumber?: string;
  latitude?: number;
  longitude?: number;
}

export default function TradeDetail() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const profileData = profile as AppProfile | null;
  const { sendNotification } = useNotifications();

  const [trade, setTrade] = useState<(Trade & { typing?: Record<string, boolean> }) | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showDriverRating, setShowDriverRating] = useState(false);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [showDriverSelection, setShowDriverSelection] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBuyer = Boolean(user?.uid && trade?.buyerId && user.uid === trade.buyerId);
  const isSeller = Boolean(user?.uid && trade?.sellerId && user.uid === trade.sellerId);
  const isDriver = Boolean(user?.uid && trade?.driverId && user.uid === trade.driverId);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.flutterwave.com/v3.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      script.parentNode?.removeChild(script);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const verifyPaymentOnServer = async (transactionId: string) => {
    const activeTradeId = trade?.id || id;
    if (!activeTradeId) return;

    setUpdating(true);

    try {
      const response = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, tradeId: activeTradeId })
      });

      if (!response.ok) {
        throw new Error('Payment verification failed.');
      }

      const result = await response.json();

      if (result.success) {
        sendNotification(trade?.sellerId || '', {
          title: 'Payment Received',
          body: `The buyer has funded the escrow for ${listing?.title || 'this order'}. Please proceed with fulfillment.`,
          type: 'trade_update',
          targetId: activeTradeId
        });
      } else {
        alert(`Payment verification failed: ${result.message || 'Please contact support.'}`);
      }
    } catch (err) {
      console.error('Verification error:', err);
      alert('Error verifying payment. Please contact support if payment was completed.');
    } finally {
      setUpdating(false);
    }
  };

  const handlePayment = () => {
    if (!trade || !user || !profileData) return;

    const publicKey = import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY;

    if (!publicKey) {
      alert('Payment gateway is not configured.');
      return;
    }

    if (!window.FlutterwaveCheckout) {
      alert('Payment gateway is still loading. Please try again in a moment.');
      return;
    }

    const amountInCFA = trade.amount * 650;

    window.FlutterwaveCheckout({
      public_key: publicKey,
      tx_ref: `trade_${trade.id}_${Date.now()}`,
      amount: amountInCFA,
      currency: 'XAF',
      payment_options: 'mobilemoneyfranco, card',
      customer: {
        email: user.email || '',
        phone_number: profileData.phoneNumber || '',
        name: profileData.displayName || profileData.name || 'Marketplace User'
      },
      callback: (data: any) => {
        if (data.status === 'successful') {
          verifyPaymentOnServer(data.transaction_id);
        }
      },
      onclose: () => {
        console.log('Payment closed');
      },
      customizations: {
        title: 'Hema Trader Escrow',
        description: `Payment for ${listing?.title || 'trade order'}`,
        logo: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png'
      }
    });
  };

  const setTypingStatus = async (isTyping: boolean) => {
    if (!id || !user) return;

    try {
      await updateDoc(doc(db, 'trades', id), {
        [`typing.${user.uid}`]: isTyping
      });
    } catch {
      // Typing indicators should never block chat usage.
    }
  };

  const handleTyping = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    } else {
      setTypingStatus(true);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setTypingStatus(false);
      typingTimeoutRef.current = null;
    }, 3000);
  };

  useEffect(() => {
    if (!id) return;

    let isMounted = true;

    setLoading(true);
    setError(null);

    const tradeRef = doc(db, 'trades', id);

    const unsubscribeTrade = onSnapshot(
      tradeRef,
      async docSnap => {
        if (!isMounted) return;

        if (!docSnap.exists()) {
          setError('Trade record not found in registry.');
          setLoading(false);
          return;
        }

        const tradeData = {
          id: docSnap.id,
          ...docSnap.data()
        } as Trade & { typing?: Record<string, boolean> };

        setTrade(tradeData);

        try {
          const listingSnap = await getDoc(doc(db, 'listings', tradeData.listingId));

          if (isMounted && listingSnap.exists()) {
            setListing(listingSnap.data() as Listing);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.READ, `listings/${tradeData.listingId}`);
        }

        setLoading(false);
      },
      err => {
        const message = handleFirestoreError(err, OperationType.SUBSCRIBE, `trades/${id}`);
        setError(message);
        setLoading(false);
      }
    );

    const chatRef = collection(db, 'trades', id, 'messages');
    const unsubscribeChat = onSnapshot(
      query(chatRef, orderBy('createdAt', 'asc')),
      snapshot => {
        if (isMounted) {
          setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
        }
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, `trades/${id}/messages`)
    );

    const offersRef = collection(db, 'trades', id, 'offers');
    const unsubscribeOffers = onSnapshot(
      query(offersRef, orderBy('createdAt', 'desc')),
      snapshot => {
        if (isMounted) {
          setOffers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Offer)));
        }
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, `trades/${id}/offers`)
    );

    const driversRef = collection(db, 'users');
    const unsubscribeDrivers = onSnapshot(
      query(driversRef, where('roles', 'array-contains', 'driver')),
      snapshot => {
        if (isMounted) {
          setDrivers(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, 'users/drivers')
    );

    return () => {
      isMounted = false;
      unsubscribeTrade();
      unsubscribeChat();
      unsubscribeOffers();
      unsubscribeDrivers();
    };
  }, [id]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!id || !newMessage.trim() || !user || !trade) return;

    const text = newMessage.trim();

    setNewMessage('');
    setTypingStatus(false);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    try {
      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: user.uid,
        text,
        createdAt: serverTimestamp()
      });

      const recipientId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;

      sendNotification(recipientId, {
        title: `Message from ${profileData?.displayName || profileData?.name || 'Peer'}`,
        body: text,
        type: 'message',
        targetId: id
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `trades/${id}/messages`);
    }
  };

  const updateStatus = async (newStatus: Trade['status'], extras: Record<string, any> = {}) => {
    if (!id || !trade || !user) return;

    setUpdating(true);

    try {
      const updates: Record<string, any> = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        ...extras
      };

      if (newStatus === 'funded' && !trade.platformFee) {
        updates.platformFee = trade.amount * 0.02;
      }

      await updateDoc(doc(db, 'trades', id), updates);

      const recipientId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;
      let notificationTitle = 'Order Update';
      let notificationBody = '';
      let systemMessage = '';

      if (newStatus === 'funded') {
        systemMessage = 'Payment secured in escrow. Seller: please prepare the items and update once shipped.';
        notificationTitle = 'Payment Secured';
        notificationBody = 'Buyer has paid. Please prepare for shipment.';
      } else if (newStatus === 'shipped') {
        systemMessage = 'Items are on the way. Buyer: please confirm here once they arrive so we can release the funds.';
        notificationTitle = 'Package Shipped';
        notificationBody = 'Items are on the way. Please confirm once received.';
      } else if (newStatus === 'completed') {
        systemMessage = 'Transaction finalized. Thank you for using Hema Trader.';
        notificationTitle = 'Trade Completed';
        notificationBody = 'Transaction finalized. Thank you for using Hema Trader.';
        setShowRating(true);

        try {
          await fetch('/api/trades/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: id, userId: user.uid })
          });
        } catch (err) {
          console.error('Server finalization failed:', err);
        }
      } else if (newStatus === 'disputed') {
        systemMessage = 'A dispute has been opened. Our support team is joining the conversation to help.';
        notificationTitle = 'Dispute Opened';
        notificationBody = 'A dispute has been opened for your trade.';
      }

      if (notificationBody) {
        sendNotification(recipientId, {
          title: notificationTitle,
          body: notificationBody,
          type: 'trade_update',
          targetId: id
        });
      }

      if (systemMessage) {
        await addDoc(collection(db, 'trades', id, 'messages'), {
          senderId: 'system',
          text: systemMessage,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${id}`);
    } finally {
      setUpdating(false);
    }
  };

  const submitOffer = async () => {
    if (!id || !user || !newOfferAmount || !trade) return;

    const amount = Number(newOfferAmount);

    if (!Number.isFinite(amount) || amount <= 0) return;

    setUpdating(true);

    try {
      await addDoc(collection(db, 'trades', id, 'offers'), {
        senderId: user.uid,
        amount,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `New offer submitted: $${amount.toLocaleString()}. Awaiting peer response.`,
        createdAt: serverTimestamp()
      });

      const recipientId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;

      sendNotification(recipientId, {
        title: 'New Price Offer',
        body: `${profileData?.displayName || profileData?.name || 'User'} proposed $${amount.toLocaleString()}`,
        type: 'offer',
        targetId: id
      });

      setNewOfferAmount('');
      setShowNegotiation(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `trades/${id}/offers`);
    } finally {
      setUpdating(false);
    }
  };

  const handleOfferResponse = async (
    offerId: string,
    status: 'accepted' | 'declined',
    amount: number
  ) => {
    if (!id || !trade || !user) return;

    setUpdating(true);

    try {
      const offerRef = doc(db, 'trades', id, 'offers', offerId);
      const offerSnap = await getDoc(offerRef);

      if (!offerSnap.exists()) {
        throw new Error('Offer not found.');
      }

      const offerSenderId = offerSnap.data().senderId;

      await updateDoc(offerRef, {
        status,
        updatedAt: serverTimestamp()
      });

      if (status === 'accepted') {
        await updateDoc(doc(db, 'trades', id), {
          amount,
          updatedAt: serverTimestamp()
        });
      }

      if (offerSenderId && offerSenderId !== user.uid) {
        sendNotification(offerSenderId, {
          title: `Offer ${status === 'accepted' ? 'Accepted' : 'Declined'}`,
          body: `Your $${amount.toLocaleString()} offer has been ${status}.`,
          type: 'offer',
          targetId: id
        });
      }

      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `Offer for $${amount.toLocaleString()} ${status}. Order updated.`,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${id}/offers/${offerId}`);
    } finally {
      setUpdating(false);
    }
  };

  const broadcastRequest = async () => {
    if (!id || !trade) return;

    const latitude = profileData?.latitude;
    const longitude = profileData?.longitude;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      alert('Add your delivery location before broadcasting to drivers.');
      return;
    }

    setBroadcasting(true);

    try {
      const bestDrivers = await findOptimalDrivers(latitude, longitude);
      const deliveryFee = 2500;
      const driverCommission = deliveryFee * 0.8;

      await updateDoc(doc(db, 'trades', id), {
        deliveryRequestStatus: 'open',
        deliveryFee,
        driverCommission,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `Delivery broadcast sent to ${bestDrivers.length} top-rated nearby drivers. First to accept will be assigned.`,
        createdAt: serverTimestamp()
      });

      bestDrivers.forEach(driver => {
        sendNotification(driver.id, {
          title: 'New Delivery Opportunity',
          body: `Nearby delivery request for ${listing?.title || 'an order'}. Earn ${driverCommission} CFA.`,
          type: 'trade_update',
          targetId: id
        });
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `trades/${id}/delivery-broadcast`);
    } finally {
      setBroadcasting(false);
    }
  };

  const assignDriver = async (driverId: string) => {
    if (!id || !trade) return;

    setUpdating(true);

    try {
      const deliveryFee = 1500;
      const driverCommission = deliveryFee * 0.8;

      await updateDoc(doc(db, 'trades', id), {
        driverId,
        deliveryFee,
        driverCommission,
        deliveryStatus: 'assigned',
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `Driver assigned for delivery. Delivery fee of ${deliveryFee.toLocaleString()} CFA applied.`,
        createdAt: serverTimestamp()
      });

      sendNotification(driverId, {
        title: 'Delivery Assigned',
        body: `You have been assigned delivery for ${listing?.title || 'an order'}.`,
        type: 'delivery',
        targetId: id
      });

      setShowDriverSelection(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${id}/driver`);
    } finally {
      setUpdating(false);
    }
  };

  const updateDeliveryStatus = async (tradeId: string, newStatus: string) => {
    if (!trade || !user) return;

    setUpdating(true);

    try {
      await updateDoc(doc(db, 'trades', tradeId), {
        deliveryStatus: newStatus,
        updatedAt: serverTimestamp()
      });

      let message = '';

      if (newStatus === 'accepted') {
        message = 'Driver has accepted the delivery request and is heading to pickup.';
      }

      if (newStatus === 'picked_up') {
        message = 'Items have been picked up and are now in transit.';
      }

      if (newStatus === 'delivered') {
        message = 'Driver has confirmed delivery of your items.';
      }

      if (newStatus === 'rejected') {
        message = 'Driver declined delivery. Please select another driver.';
      }

      if (message) {
        await addDoc(collection(db, 'trades', tradeId, 'messages'), {
          senderId: 'system',
          text: message,
          createdAt: serverTimestamp()
        });

        sendNotification(trade.buyerId, {
          title: 'Delivery Update',
          body: message,
          type: 'delivery',
          targetId: tradeId
        });

        sendNotification(trade.sellerId, {
          title: 'Delivery Update',
          body: message,
          type: 'delivery',
          targetId: tradeId
        });
      }

      if (newStatus === 'delivered' && isBuyer) {
        setShowDriverRating(true);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${tradeId}`);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-brand-bg p-12">
        <Loader2 className="h-12 w-12 animate-spin text-amber-500" />
        <p className="animate-pulse text-[10px] font-bold uppercase tracking-wider text-slate-600">
          Loading order details...
        </p>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="mx-auto mt-20 max-w-xl rounded-[3rem] border border-white/5 bg-brand-card p-6 py-32 text-center shadow-2xl">
        <AlertCircle className="mx-auto mb-8 h-20 w-20 text-red-500/20" />
        <h2 className="mb-4 font-serif text-3xl text-white">Order details unavailable</h2>
        <p className="mb-10 font-serif italic leading-relaxed text-slate-500">
          {error || 'This order could not be found or has been completed.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/10 px-10 py-5 text-[10px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/5"
        >
          Try Reloading
        </button>
      </div>
    );
  }

  const steps = [
    {
      key: 'pending',
      label: 'Payment',
      description: 'Confirm terms and send funds to secure escrow',
      icon: ShieldCheck
    },
    {
      key: 'funded',
      label: 'Processing',
      description: 'Funds held safely while seller prepares delivery',
      icon: CreditCard
    },
    {
      key: 'shipped',
      label: 'In Transit',
      description: 'Item is on its way to you',
      icon: Truck
    },
    {
      key: 'completed',
      label: 'Finalized',
      description: 'Trade closed and funds released',
      icon: CheckCircle2
    }
  ];

  if (trade.status === 'disputed') {
    steps.push({
      key: 'disputed',
      label: 'Disputed',
      description: 'Our team is reviewing the transaction',
      icon: AlertCircle
    });
  }

  const rawStep = trade.status === 'disputed' ? 4 : steps.findIndex(step => step.key === trade.status);
  const currentStep = rawStep >= 0 ? rawStep : 0;
  const stepProgress = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-6xl flex-col gap-6 md:h-[calc(100vh-8rem)]">
      <div className="flex shrink-0 flex-col gap-6 md:flex-row">
        <div className="flex flex-1 items-center gap-6 rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-900">
            {listing?.images?.[0] && (
              <img
                src={listing.images[0]}
                className="h-full w-full object-cover grayscale-[0.3]"
                alt={listing.title}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-xl text-white">
              {listing?.title || 'Trade Details'}
            </h2>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {listing ? `${listing.quantity} - ${listing.category}` : 'Listing details loading'}
            </p>
          </div>

          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
              ${trade.amount}
            </p>
            {trade.platformFee && (
              <p className="mt-1 text-[7px] font-black uppercase tracking-widest text-slate-600">
                Fee: -${trade.platformFee.toFixed(2)}
              </p>
            )}
            <p className="mt-1 text-[8px] font-bold uppercase tracking-wider text-slate-700">
              ID: {trade.id.slice(-6).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="md:hidden">
          {trade.status === 'pending' && isBuyer && (
            <button
              onClick={handlePayment}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              {updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-4 w-4" />
                  Pay with MoMo / Card
                </>
              )}
            </button>
          )}

          {trade.status === 'funded' && isBuyer && !trade.driverId && (
            <button
              onClick={() => setShowDriverSelection(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              <Truck className="h-4 w-4" />
              Select Delivery Driver
            </button>
          )}

          {trade.status === 'funded' && isSeller && (
            <button
              onClick={() => updateStatus('shipped')}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              {updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Package className="h-4 w-4" />
                  Mark as Shipped
                </>
              )}
            </button>
          )}

          {isDriver && trade.deliveryStatus === 'assigned' && (
            <div className="flex gap-2">
              <button
                onClick={() => updateDeliveryStatus(trade.id, 'accepted')}
                className="flex-1 rounded-2xl bg-green-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
              >
                Accept Delivery
              </button>
              <button
                onClick={() => updateDeliveryStatus(trade.id, 'rejected')}
                className="flex-1 rounded-2xl bg-red-500 py-5 text-[10px] font-bold uppercase tracking-widest text-white shadow-2xl"
              >
                Reject
              </button>
            </div>
          )}

          {isDriver && trade.deliveryStatus === 'accepted' && (
            <button
              onClick={() => updateDeliveryStatus(trade.id, 'picked_up')}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              Confirm Pick Up
            </button>
          )}

          {isDriver && trade.deliveryStatus === 'picked_up' && (
            <button
              onClick={() => updateDeliveryStatus(trade.id, 'delivered')}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-green-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              Confirm Delivery
            </button>
          )}

          {trade.status === 'shipped' && isBuyer && (
            <button
              onClick={() => updateStatus('completed')}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              {updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Received
                </>
              )}
            </button>
          )}

          {trade.status === 'completed' && (
            <div className="flex w-full items-center justify-center gap-3 rounded-2xl border border-green-500/20 bg-green-500/10 py-5 text-[10px] font-bold uppercase tracking-widest text-green-500">
              Trade Completed
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
          <div className="flex items-center gap-3 border-b border-white/5 bg-white/[0.01] p-6">
            <MessageCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Messages
            </h3>
          </div>

          <div className="scrollbar-hide flex-1 space-y-6 overflow-y-auto p-6">
            {messages.length < 10 && trade.status === 'pending' && (
              <div className="mb-6 space-y-3 rounded-3xl border border-amber-500/10 bg-amber-500/5 p-6 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                    Chat & Negotiate
                  </p>
                  <p className="mt-1 font-serif text-[11px] italic leading-relaxed text-slate-500">
                    {isBuyer
                      ? 'Discuss delivery details or propose a new price. Your funds stay safe until you confirm the item has arrived.'
                      : "Answer any questions the buyer has. Once they pay into escrow, you'll be notified to ship the items."}
                  </p>
                </div>
              </div>
            )}

            {messages.map(message => {
              const isMine = message.senderId === user?.uid;

              return (
                <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl border px-5 py-3 shadow-2xl ${
                      isMine
                        ? 'rounded-tr-none border-amber-500/20 bg-amber-500/10 text-white'
                        : 'rounded-tl-none border-white/5 bg-white/5 text-slate-300'
                    }`}
                  >
                    <p className="font-serif text-sm leading-relaxed">{message.text}</p>
                    <p
                      className={`mt-2 text-[8px] font-black uppercase tracking-widest opacity-40 ${
                        isMine ? 'text-right' : 'text-left'
                      }`}
                    >
                      {formatMessageTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}

            {Object.entries(trade.typing || {}).some(
              ([uid, typing]) => uid !== user?.uid && typing
            ) && (
              <div className="flex justify-start">
                <div className="animate-pulse rounded-2xl border border-white/5 bg-white/5 px-5 py-2 text-[10px] text-slate-500">
                  Peer is typing...
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>

          <form
            onSubmit={sendMessage}
            className="flex flex-col gap-3 border-t border-white/5 bg-white/[0.01] p-4"
          >
            <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-2">
              {['Is this available?', 'When can you ship?', 'I have a question', 'Can we meet?'].map(text => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setNewMessage(text)}
                  className="whitespace-nowrap rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-500 transition-all hover:border-amber-500/30 hover:text-white"
                >
                  {text}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={newMessage}
                onChange={e => {
                  setNewMessage(e.target.value);
                  handleTyping();
                }}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-white/5 bg-black/40 px-5 py-3 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
              />

              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black shadow-xl transition-all hover:bg-slate-200 disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </form>
        </div>

        <div className="hidden w-80 shrink-0 flex-col gap-6 lg:flex">
          <div className="space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
            <div className="space-y-6">
              <div className="flex flex-col items-center space-y-2 border-b border-white/5 pb-6 text-center">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                  Order Progress
                </h4>
                <div className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500">
                    {trade.status === 'pending'
                      ? 'Negotiating Terms'
                      : trade.status === 'funded'
                        ? 'Payment in Escrow'
                        : trade.status === 'shipped'
                          ? 'Package in Transit'
                          : trade.status === 'disputed'
                            ? 'Dispute Open'
                            : 'Order Finalized'}
                  </span>
                </div>
              </div>

              <div className="relative space-y-6">
                <div className="absolute bottom-0 left-[19px] top-0 w-[2px] bg-white/5" />
                <div
                  className="absolute left-[19px] top-0 w-[2px] bg-amber-500/50 transition-all duration-1000"
                  style={{ height: `${stepProgress}%` }}
                />

                {steps.map((step, index) => {
                  const active = index <= currentStep;
                  const isCurrent = index === currentStep;

                  return (
                    <div key={step.key} className="relative z-10 flex items-start gap-4">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-500 ${
                          active
                            ? 'border-amber-500 bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                            : 'border-white/5 bg-black/40 text-slate-800'
                        }`}
                      >
                        <step.icon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 pt-1">
                        <p
                          className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                            active ? 'text-white' : 'text-slate-700'
                          }`}
                        >
                          {step.label}
                        </p>
                        <p
                          className={`mt-1 font-serif text-[9px] italic leading-tight ${
                            isCurrent ? 'text-amber-500/80' : 'text-slate-600'
                          }`}
                        >
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6 pt-4">
              <div className="flex items-center justify-center gap-2 border-b border-white/5 pb-4">
                <Truck className="h-3 w-3 text-slate-500" />
                <h4 className="text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                  Transport Details
                </h4>
              </div>

              {trade.driverId ? (
                <div className="space-y-4 rounded-2xl border border-white/5 bg-black/40 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
                      <Truck className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">
                        Delivery Partner
                      </p>
                      <p className="text-[9px] uppercase tracking-widest text-slate-500">
                        ID: {trade.driverId.slice(-6)}
                      </p>
                    </div>
                  </div>

                  {trade.deliveryETA && (
                    <div className="flex items-center justify-between border-t border-white/5 pt-2">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                        Estimated Arrival
                      </span>
                      <span className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                        {trade.deliveryETA}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-white/5 pt-2">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                      Status
                    </span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-green-500">
                      {trade.deliveryStatus || 'Assigned'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                      Fee
                    </span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-white">
                      {trade.deliveryFee || 0} CFA
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center">
                  <p className="font-serif text-[9px] italic uppercase leading-relaxed tracking-widest text-slate-600">
                    No transport provider selected yet
                  </p>
                </div>
              )}

              {trade.status === 'funded' && isBuyer && !trade.driverId && (
                <div className="space-y-3">
                  <button
                    onClick={broadcastRequest}
                    disabled={broadcasting || trade.deliveryRequestStatus === 'open'}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400 disabled:opacity-50"
                  >
                    {broadcasting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Truck className="h-4 w-4" />
                        {trade.deliveryRequestStatus === 'open' ? 'Request Broadcasted' : 'Broadcast Request'}
                      </>
                    )}
                  </button>

                  {trade.deliveryRequestStatus === 'open' && (
                    <p className="animate-pulse text-center text-[8px] font-black uppercase text-amber-500/50">
                      Waiting for driver to claim...
                    </p>
                  )}

                  <button
                    onClick={() => setShowDriverSelection(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:bg-white/10"
                  >
                    Select Manually
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-6 pt-4">
              <div className="space-y-4">
                {offers.length > 0 ? (
                  <div className="space-y-3">
                    {offers.slice(0, 3).map(offer => (
                      <div
                        key={offer.id}
                        className={`space-y-3 rounded-xl border p-4 transition-all ${
                          offer.status === 'pending'
                            ? 'border-amber-500/20 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                            : 'border-white/5 bg-black/40 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                            {offer.senderId === user?.uid ? 'Your Offer' : 'Peer Offer'}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${
                              offer.status === 'accepted'
                                ? 'border-green-500/30 bg-green-500/5 text-green-500'
                                : offer.status === 'declined'
                                  ? 'border-red-500/30 bg-red-500/5 text-red-500'
                                  : 'border-amber-500 bg-amber-500 text-black'
                            }`}
                          >
                            {offer.status}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-1">
                          <p className="text-xl font-bold tracking-tight text-white">
                            ${offer.amount.toLocaleString()}
                          </p>
                          {offer.status === 'pending' && (
                            <p className="animate-pulse text-[8px] font-black uppercase text-amber-500/50">
                              Active
                            </p>
                          )}
                        </div>

                        {offer.status === 'pending' && offer.senderId !== user?.uid && trade.status === 'pending' && (
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() => handleOfferResponse(offer.id, 'accepted', offer.amount)}
                              disabled={updating}
                              className="flex-1 rounded-lg bg-white py-2 text-[8px] font-black uppercase text-black transition-all hover:bg-amber-500"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleOfferResponse(offer.id, 'declined', offer.amount)}
                              disabled={updating}
                              className="flex-1 rounded-lg bg-red-500/10 py-2 text-[8px] font-black uppercase text-red-500 transition-all hover:bg-red-500 hover:text-white"
                            >
                              Decline
                            </button>
                          </div>
                        )}

                        {offer.status === 'pending' && offer.senderId === user?.uid && (
                          <p className="mt-2 font-serif text-[9px] italic leading-none text-slate-600">
                            Awaiting decision...
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center font-serif text-[9px] italic uppercase tracking-widest text-slate-600">
                    No active offers discovered
                  </p>
                )}

                {trade.status === 'pending' && !showNegotiation ? (
                  <button
                    onClick={() => setShowNegotiation(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400"
                  >
                    <Scale className="h-4 w-4" />
                    Propose Terms
                  </button>
                ) : trade.status === 'pending' ? (
                  <div className="space-y-3 rounded-2xl border border-amber-500/20 bg-white/5 p-4">
                    <input
                      type="number"
                      min="1"
                      value={newOfferAmount}
                      onChange={e => setNewOfferAmount(e.target.value)}
                      placeholder="New Valuation ($)"
                      className="w-full rounded-lg border border-white/5 bg-black/40 px-4 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitOffer}
                        disabled={updating || !newOfferAmount}
                        className="flex-1 rounded-lg bg-white py-2 text-[9px] font-black uppercase text-black disabled:opacity-50"
                      >
                        Submit
                      </button>
                      <button
                        onClick={() => setShowNegotiation(false)}
                        className="rounded-lg bg-white/5 px-4 py-2 text-[9px] font-black uppercase text-slate-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-6 pt-4">
              <h4 className="border-b border-white/5 pb-4 text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                Order Actions
              </h4>

              {trade.status === 'pending' && isBuyer && (
                <div className="space-y-4">
                  <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-amber-500" />
                    <p className="font-serif text-[9px] italic leading-relaxed text-slate-400">
                      Heads up: Your funds will be stored in a secure escrow account and only released when you confirm receipt.
                    </p>
                  </div>
                  <button
                    onClick={handlePayment}
                    disabled={updating}
                    className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-slate-200 active:scale-[0.98]"
                  >
                    {updating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Smartphone className="h-4 w-4" />
                        Pay with MoMo / Card
                      </>
                    )}
                  </button>
                </div>
              )}

              {trade.status === 'funded' && isSeller && (
                <div className="space-y-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Payment confirmed in escrow. Please arrange delivery and update status once shipped.
                  </p>
                  <button
                    onClick={() => updateStatus('shipped')}
                    disabled={updating}
                    className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-amber-400 active:scale-[0.98]"
                  >
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Items Shipped'}
                  </button>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'assigned' && (
                <div className="space-y-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    You have been assigned this delivery.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateDeliveryStatus(trade.id, 'accepted')}
                      className="flex-1 rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => updateDeliveryStatus(trade.id, 'rejected')}
                      className="flex-1 rounded-xl border border-red-500/20 bg-red-500/10 py-4 text-[10px] font-black uppercase tracking-widest text-red-500"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'accepted' && (
                <div className="space-y-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Proceed to pickup location.
                  </p>
                  <button
                    onClick={() => updateDeliveryStatus(trade.id, 'picked_up')}
                    className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                  >
                    Confirm Pick Up
                  </button>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'picked_up' && (
                <div className="space-y-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Deliver items to the buyer.
                  </p>
                  <button
                    onClick={() => updateDeliveryStatus(trade.id, 'delivered')}
                    className="w-full rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                  >
                    Confirm Delivery
                  </button>
                </div>
              )}

              {trade.status === 'shipped' && isBuyer && (
                <div className="space-y-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Your items are on the way. Confirm below only once you have received and inspected them.
                  </p>
                  <button
                    onClick={() => updateStatus('completed')}
                    disabled={updating}
                    className="w-full rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-slate-200 active:scale-[0.98]"
                  >
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'I Have Received My Order'}
                  </button>
                </div>
              )}

              {trade.status === 'completed' && (
                <div className="space-y-6">
                  <div className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-6 text-center">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                    <p className="font-serif text-lg text-white">Order Completed</p>
                    {!showRating && (
                      <button
                        onClick={() => setShowRating(true)}
                        className="w-full rounded-xl border border-white/5 bg-white/10 py-3 text-[9px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/20"
                      >
                        Rate this transaction
                      </button>
                    )}
                  </div>

                  <div className="space-y-4 rounded-3xl border border-white/5 bg-black/20 p-6 text-center">
                    <p className="text-[9px] font-bold uppercase leading-none tracking-widest text-slate-500">
                      Keep the Marketplace Moving
                    </p>
                    <div className="flex flex-col gap-2">
                      <Link
                        to="/"
                        className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-[9px] font-bold uppercase tracking-widest text-black transition-all hover:bg-amber-500"
                      >
                        Browse Similar Items
                      </Link>
                      <Link
                        to="/create-listing"
                        className="flex items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[9px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/10"
                      >
                        List your own item
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {trade.status !== 'completed' && trade.status !== 'cancelled' && trade.status !== 'disputed' && (
                <div className="border-t border-white/5 pt-4">
                  <button
                    onClick={() => updateStatus('disputed')}
                    disabled={updating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 transition-all hover:bg-red-500/20"
                  >
                    <AlertCircle className="h-4 w-4" />
                    Need Help? Open a Dispute
                  </button>
                </div>
              )}

              {trade.status === 'disputed' && (
                <div className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
                  <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
                  <p className="font-serif text-lg text-white">Dispute Open</p>
                  <p className="text-[9px] uppercase leading-relaxed tracking-widest text-slate-500">
                    Our support team has been notified and will contact you shortly to help resolve this.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showDriverSelection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-lg space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl"
            >
              <div className="space-y-3 text-center">
                <Truck className="mx-auto h-10 w-10 text-amber-500" />
                <h2 className="font-serif text-3xl text-white">Select a Driver</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Pick a trusted delivery partner for your trade
                </p>
              </div>

              <div className="scrollbar-hide max-h-[40vh] space-y-4 overflow-y-auto pr-2">
                {drivers.length > 0 ? (
                  drivers.map(driver => (
                    <button
                      key={driver.id}
                      onClick={() => assignDriver(driver.id)}
                      className="group flex w-full items-center gap-4 rounded-2xl border border-white/5 bg-black/40 p-5 text-left transition-all hover:border-amber-500/50"
                    >
                      <div className="h-12 w-12 overflow-hidden rounded-full border border-white/10">
                        <img
                          src={driver.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`}
                          alt={driver.displayName || driver.name || 'Driver'}
                        />
                      </div>
                      <div className="flex-1">
                        <p className="font-serif text-lg text-white group-hover:text-amber-500">
                          {driver.displayName || driver.name || 'Driver'}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                            {driver.vehicleType || 'Motorbike'}
                          </span>
                          <div className="h-1 w-1 rounded-full bg-slate-800" />
                          <span className="text-[8px] font-black uppercase tracking-widest text-green-500">
                            {driver.driverStatus || 'Available'}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-700 group-hover:text-amber-500" />
                    </button>
                  ))
                ) : (
                  <div className="py-10 text-center text-[10px] uppercase tracking-[0.2em] text-slate-600">
                    No drivers available nearby
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowDriverSelection(false)}
                className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}

        {showRating && trade && (
          <RatingModal
            tradeId={trade.id}
            revieweeId={isBuyer ? trade.sellerId : trade.buyerId}
            onClose={() => setShowRating(false)}
            onSuccess={() => setShowRating(false)}
          />
        )}

        {showDriverRating && trade && trade.driverId && (
          <DriverRatingModal
            tradeId={trade.id}
            driverId={trade.driverId}
            onClose={() => setShowDriverRating(false)}
            onSuccess={() => setShowDriverRating(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
