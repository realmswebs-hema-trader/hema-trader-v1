import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { 
  MessageCircle, 
  Send, 
  CreditCard, 
  Truck, 
  CheckCircle2, 
  Loader2, 
  ShieldCheck,
  Package,
  History,
  Scale,
  XCircle,
  AlertCircle,
  ArrowRight,
  Smartphone
} from 'lucide-react';

declare global {
  interface Window {
    FlutterwaveCheckout: any;
  }
}
import { motion, AnimatePresence } from 'motion/react';
import RatingModal from '../components/trade/RatingModal';
import DriverRatingModal from '../components/trade/DriverRatingModal';
import { findOptimalDrivers, estimateDeliveryTime } from '../services/matchingService';

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

export default function TradeDetail() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();
  const [trade, setTrade] = useState<(Trade & { typing?: Record<string, boolean> }) | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [newOfferAmount, setNewOfferAmount] = useState<string>('');
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
  const [eta, setEta] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load Flutterwave Script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.flutterwave.com/v3.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handlePayment = () => {
    if (!trade || !user || !profile) return;
    
    // Convert to CFA (simplified conversion for demo)
    const amountInCFA = trade.amount * 650; 

    window.FlutterwaveCheckout({
      public_key: import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: `trade_${trade.id}_${Date.now()}`,
      amount: amountInCFA,
      currency: "XAF", // Central African CFA Franc
      payment_options: "mobilemoneyfranco, card",
      customer: {
        email: user.email || "",
        phone_number: profile.phoneNumber || "",
        name: profile.displayName || "Marketplace User",
      },
      callback: (data: any) => {
        console.log("Payment callback:", data);
        if (data.status === "successful") {
          verifyPaymentOnServer(data.transaction_id);
        }
      },
      onclose: () => {
        console.log("Payment closed");
      },
      customizations: {
        title: "Hema Trader Escrow",
        description: `Payment for ${listing?.title}`,
        logo: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png", // Replace with app logo
      },
    });
  };

  const verifyPaymentOnServer = async (transactionId: string) => {
    setUpdating(true);
    try {
      const response = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, tradeId: id }),
      });
      const result = await response.json();
      if (result.success) {
        sendNotification(trade?.sellerId || '', {
          title: 'Payment Received',
          body: `The buyer has funded the escrow for ${listing?.title}. Please proceed with fulfillment.`,
          type: 'trade_update',
          targetId: id
        });
      } else {
        alert("Payment verification failed: " + result.message);
      }
    } catch (err) {
      console.error("Verification error:", err);
      alert("Error verifying payment");
    } finally {
      setUpdating(false);
    }
  };

  const setTypingStatus = async (isTyping: boolean) => {
    if (!id || !user) return;
    try {
      await updateDoc(doc(db, 'trades', id), {
        [`typing.${user.uid}`]: isTyping
      });
    } catch (e) {
      // Heartbeat failure is fine
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

    console.log('Synchronizing with trade ledger:', id);
    setLoading(true);
    setError(null);

    // Fetch Trade
    const tradeRef = doc(db, 'trades', id);
    const unsubscribeTrade = onSnapshot(tradeRef, async (docSnap) => {
      if (!isMounted) return;

      if (docSnap.exists()) {
        const tData = { id: docSnap.id, ...docSnap.data() } as Trade & { typing?: Record<string, boolean> };
        setTrade(tData);

        // Fetch Listing
        try {
          const listSnap = await getDoc(doc(db, 'listings', tData.listingId));
          if (isMounted && listSnap.exists()) {
            setListing(listSnap.data() as Listing);
          }
        } catch (err) {
          console.error('Listing fetch failed in trade context:', err);
        }
      } else {
        setError('Trade record not found in registry.');
      }
      setLoading(false);
    }, (err) => {
      console.error('Trade Snapshot Error:', err);
      setError(err.message || 'Trade ledger connection failure.');
      setLoading(false);
    });

    // Fetch Messages
    const chatRef = collection(db, 'trades', id, 'messages');
    const qChat = query(chatRef, orderBy('createdAt', 'asc'));
    const unsubscribeChat = onSnapshot(qChat, (snapshot) => {
      if (isMounted) {
        setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
      }
    }, (err) => console.error('Chat Sync Error:', err));

    // Fetch Offers
    const offersRef = collection(db, 'trades', id, 'offers');
    const qOffers = query(offersRef, orderBy('createdAt', 'desc'));
    const unsubscribeOffers = onSnapshot(qOffers, (snapshot) => {
      if (isMounted) {
        setOffers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Offer)));
      }
    }, (err) => console.error('Offers Sync Error:', err));

    // Fetch Drivers
    const driversRef = collection(db, 'users');
    const qDrivers = query(driversRef, where('roles', 'array-contains', 'driver'));
    const unsubscribeDrivers = onSnapshot(qDrivers, (snapshot) => {
      if (isMounted) {
        setDrivers(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    });

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

    const text = newMessage;
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
        title: `Message from ${profile?.displayName || 'Peer'}`,
        body: text,
        type: 'message',
        targetId: id
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `trades/${id}/messages`);
    }
  };

  const updateStatus = async (newStatus: Trade['status'], extras: any = {}) => {
    if (!id || !trade || !user) return;
    setUpdating(true);
    try {
      const updates: any = { 
        status: newStatus,
        updatedAt: serverTimestamp(),
        ...extras
      };

      // Revenue Logic: Apply 2% platform fee on funding
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
        systemMessage = 'Items are on the way! Buyer: please confirm here once they arrive so we can release the funds.';
        notificationTitle = 'Package Shipped';
        notificationBody = 'Items are on the way! Please confirm once received.';
      } else if (newStatus === 'completed') {
        systemMessage = 'Transaction finalized. Thank you for using Hema Trader!';
        notificationTitle = 'Trade Completed';
        notificationBody = 'Transaction finalized. Thank you for using Hema Trader!';
        setShowRating(true);

        // Scalability: Call centralized API for payouts
        try {
          await fetch('/api/trades/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId: id, userId: user.uid })
          });
        } catch (err) {
          console.error('Server finalization failed, retrying client-side fallback...', err);
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trades/${id}`);
    } finally {
      setUpdating(false);
    }
  };

  const submitOffer = async () => {
    if (!id || !user || !newOfferAmount || !trade) return;
    setUpdating(true);
    try {
      await addDoc(collection(db, 'trades', id, 'offers'), {
        senderId: user.uid,
        amount: Number(newOfferAmount),
        status: 'pending',
        createdAt: serverTimestamp()
      });
      // Automated record in chat
      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `New offer submitted: $${Number(newOfferAmount).toLocaleString()}. Awaiting peer response.`,
        createdAt: serverTimestamp()
      });

      const recipientId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;
      sendNotification(recipientId, {
        title: 'New Price Offer',
        body: `${profile?.displayName || 'User'} proposed $${Number(newOfferAmount).toLocaleString()}`,
        type: 'offer',
        targetId: id
      });

      setNewOfferAmount('');
      setShowNegotiation(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `trades/${id}/offers`);
    } finally {
      setUpdating(false);
    }
  };

  const handleOfferResponse = async (offerId: string, status: 'accepted' | 'declined', amount: number) => {
    if (!id || !trade || !user) return;
    setUpdating(true);
    try {
      const offerSnap = await getDoc(doc(db, 'trades', id, 'offers', offerId));
      const offerSenderId = offerSnap.data()?.senderId;

      await updateDoc(doc(db, 'trades', id, 'offers', offerId), { 
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trades/${id}/offers/${offerId}`);
    } finally {
      setUpdating(false);
    }
  };

  const broadcastRequest = async () => {
    if (!id || !trade || !profile?.latitude) return;
    setBroadcasting(true);
    try {
      const bestDrivers = await findOptimalDrivers(profile.latitude, profile.longitude);
      
      const deliveryFee = 2500; // Simplified for demo
      const driverComm = deliveryFee * 0.8;
      
      await updateDoc(doc(db, 'trades', id), {
        deliveryRequestStatus: 'open',
        deliveryFee,
        driverCommission: driverComm,
        updatedAt: serverTimestamp()
      });

      // Clear existing system messages about broadcast
      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `🚀 DELIVERY BROADCAST: Request sent to ${bestDrivers.length} top-rated nearby drivers. First to accept will be assigned.`,
        createdAt: serverTimestamp()
      });

      // Notify drivers
      bestDrivers.forEach(d => {
        sendNotification(d.id, {
          title: 'New Delivery Opportunity',
          body: `Nearby delivery request for ${listing?.title}. Earn ${driverComm} CFA.`,
          type: 'trade_update',
          targetId: id
        });
      });

      setBroadcasting(false);
    } catch (err) {
      console.error('Broadcast error:', err);
      setBroadcasting(false);
    }
  };

  const assignDriver = async (driverId: string) => {
    if (!id || !trade) return;
    setUpdating(true);
    try {
      const deliveryFee = 1500; // Fixed delivery fee for demo
      const driverComm = deliveryFee * 0.8; // Driver takes 80%, Platform takes 20%
      
      await updateDoc(doc(db, 'trades', id), {
        driverId,
        deliveryFee,
        driverCommission: driverComm,
        deliveryStatus: 'assigned',
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'trades', id, 'messages'), {
        senderId: 'system',
        text: `Driver assigned for delivery. Delivery fee of ${deliveryFee.toLocaleString()} CFA applied (inc. insurance).`,
        createdAt: serverTimestamp()
      });

      setShowDriverSelection(false);
    } catch (err) {
      console.error('Driver assign error:', err);
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

      // System messages for delivery updates
      let msg = '';
      if (newStatus === 'accepted') msg = 'Driver has accepted the delivery request and is heading to pickup.';
      if (newStatus === 'picked_up') msg = 'Items have been picked up and are now in transit.';
      if (newStatus === 'delivered') msg = 'Driver has confirmed delivery of your items.';
      if (newStatus === 'rejected') msg = 'Driver declined delivery. Please select another driver.';

      if (msg) {
        await addDoc(collection(db, 'trades', tradeId, 'messages'), {
          senderId: 'system',
          text: msg,
          createdAt: serverTimestamp()
        });

        // Notify relevant parties
        const buyerId = trade.buyerId;
        const sellerId = trade.sellerId;
        sendNotification(buyerId, { title: 'Delivery Update', body: msg, type: 'delivery', targetId: tradeId });
        sendNotification(sellerId, { title: 'Delivery Update', body: msg, type: 'delivery', targetId: tradeId });
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
      <div className="flex h-screen flex-col items-center justify-center bg-brand-bg gap-6 p-12">
        <Loader2 className="h-12 w-12 animate-spin text-amber-500" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 animate-pulse">Loading order details...</p>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="mx-auto max-w-xl py-32 text-center p-6 bg-brand-card rounded-[3rem] border border-white/5 shadow-2xl mt-20">
        <AlertCircle className="h-20 w-20 text-red-500/20 mx-auto mb-8" />
        <h2 className="font-serif text-3xl text-white mb-4">Order details unavailable</h2>
        <p className="text-slate-500 font-serif italic mb-10 leading-relaxed">
          {error || 'This order could not be found or has been completed.'}
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/10 px-10 py-5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/5 transition-all"
        >
          Try Reloading
        </button>
      </div>
    );
  }

  const isBuyer = user?.uid === trade.buyerId;
  const isSeller = user?.uid === trade.sellerId;
  const isDriver = user?.uid === trade.driverId;

  const steps = [
    { key: 'pending', label: 'Payment', description: 'Confirm terms and send funds to secure escrow', icon: ShieldCheck },
    { key: 'funded', label: 'Processing', description: 'Funds held safely while seller prepares delivery', icon: CreditCard },
    { key: 'shipped', label: 'In Transit', description: 'Item is on its way to you', icon: Truck },
    { key: 'completed', label: 'Finalized', description: 'Trade closed and funds released', icon: CheckCircle2 },
  ];

  if (trade.status === 'disputed') {
    steps.push({ key: 'disputed', label: 'Disputed', description: 'Our team is reviewing the transaction', icon: AlertCircle });
  }

  const currentStep = trade.status === 'disputed' ? 4 : steps.findIndex(s => s.key === trade.status);

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-6xl flex-col gap-6 md:h-[calc(100vh-8rem)]">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row gap-6 shrink-0">
        <div className="flex-1 rounded-[2rem] bg-brand-card p-6 shadow-2xl border border-white/5 flex items-center gap-6">
          <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-900 shrink-0">
            {listing?.images?.[0] && <img src={listing.images[0]} className="h-full w-full object-cover grayscale-[0.3]" alt="" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-xl text-white truncate">{listing?.title || 'Trade Details'}</h2>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">{listing?.quantity} • {listing?.category}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">${trade.amount}</p>
            {trade.platformFee && (
              <p className="text-[7px] font-black text-slate-600 uppercase tracking-widest mt-1">Fee: -${trade.platformFee.toFixed(2)}</p>
            )}
            <p className="text-[8px] font-bold text-slate-700 uppercase tracking-wider mt-1">ID: {trade.id.slice(-6).toUpperCase()}</p>
          </div>
        </div>

        {/* Dynamic Action Button for Mobile */}
        <div className="md:hidden">
          {trade.status === 'pending' && isBuyer && (
            <button 
              onClick={handlePayment} 
              disabled={updating} 
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Smartphone className="h-4 w-4" /> Pay with MoMo / Card</>}
            </button>
          )}
          {trade.status === 'funded' && isBuyer && !trade.driverId && (
            <button onClick={() => setShowDriverSelection(true)} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">
              <Truck className="h-4 w-4" /> Select Delivery Driver
            </button>
          )}
          {trade.status === 'funded' && isSeller && (
            <button onClick={() => updateStatus('shipped')} disabled={updating} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Package className="h-4 w-4" /> Mark as Shipped</>}
            </button>
          )}
          {isDriver && trade.deliveryStatus === 'assigned' && (
            <div className="flex gap-2">
              <button onClick={() => updateDeliveryStatus(trade.id, 'accepted')} className="flex-1 rounded-2xl bg-green-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">Accept Delivery</button>
              <button onClick={() => updateDeliveryStatus(trade.id, 'rejected')} className="flex-1 rounded-2xl bg-red-500 py-5 text-[10px] font-bold uppercase tracking-widest text-white shadow-2xl">Reject</button>
            </div>
          )}
          {isDriver && trade.deliveryStatus === 'accepted' && (
            <button onClick={() => updateDeliveryStatus(trade.id, 'picked_up')} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">
              Confirm Pick Up
            </button>
          )}
          {isDriver && trade.deliveryStatus === 'picked_up' && (
            <button onClick={() => updateDeliveryStatus(trade.id, 'delivered')} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-green-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">
              Confirm Delivery
            </button>
          )}
          {trade.status === 'shipped' && isBuyer && (
            <button onClick={() => updateStatus('completed')} disabled={updating} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl">
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4" /> Confirm Received</>}
            </button>
          )}
          {trade.status === 'completed' && (
            <div className="flex w-full items-center justify-center gap-3 rounded-2xl bg-green-500/10 border border-green-500/20 py-5 text-[10px] font-bold uppercase tracking-widest text-green-500">
              Trade Completed
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* Chat Area */}
        <div className="flex flex-1 flex-col rounded-[2.5rem] bg-brand-card shadow-2xl border border-white/5 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-white/5 p-6 bg-white/[0.01]">
            <MessageCircle className="h-4 w-4 text-amber-500" />
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Messages</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
            {messages.length < 10 && trade.status === 'pending' && (
              <div className="p-6 bg-amber-500/5 rounded-3xl border border-amber-500/10 text-center space-y-3 mb-6">
                <div className="h-10 w-10 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto text-amber-500">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Chat & Negotiate</p>
                  <p className="text-[11px] text-slate-500 font-serif italic mt-1 leading-relaxed">
                    {isBuyer 
                      ? "Discuss delivery details or propose a new price. Your funds stay safe until you confirm the item has arrived." 
                      : "Answer any questions the buyer has. Once they pay into escrow, you'll be notified to ship the items."}
                  </p>
                </div>
              </div>
            )}
            
            {messages.map((msg) => {
              const isMine = msg.senderId === user?.uid;
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-5 py-3 shadow-2xl border ${isMine ? 'bg-amber-500/10 border-amber-500/20 text-white rounded-tr-none' : 'bg-white/5 border-white/5 text-slate-300 rounded-tl-none'}`}>
                    <p className="text-sm font-serif leading-relaxed">{msg.text}</p>
                    <p className={`mt-2 text-[8px] font-black uppercase tracking-widest opacity-40 ${isMine ? 'text-right' : 'text-left'}`}>
                      {msg.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {trade && Object.entries(trade.typing || {}).some(([uid, typing]) => uid !== user?.uid && typing) && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-5 py-2 bg-white/5 border border-white/5 text-[10px] text-slate-500 animate-pulse">
                  Peer is typing...
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          <form onSubmit={sendMessage} className="p-4 bg-white/[0.01] flex flex-col gap-3 border-t border-white/5">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {['Is this available?', 'When can you ship?', 'I have a question', 'Can we meet?'].map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setNewMessage(text)}
                  className="whitespace-nowrap rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-500 hover:border-amber-500/30 hover:text-white transition-all"
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  handleTyping();
                }}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-white/5 bg-black/40 px-5 py-3 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
              />
              <button type="submit" className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black shadow-xl hover:bg-slate-200 transition-all">
                <Send className="h-5 w-5" />
              </button>
            </div>
          </form>
        </div>

        {/* Desktop Sidebar Controls */}
        <div className="hidden w-80 shrink-0 flex-col gap-6 lg:flex">
          <div className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-8">
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center space-y-2 border-b border-white/5 pb-6">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Order Progress</h4>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[8px] font-bold text-amber-500 uppercase tracking-widest">
                    {trade.status === 'pending' ? 'Negotiating Terms' : 
                     trade.status === 'funded' ? 'Payment in Escrow' : 
                     trade.status === 'shipped' ? 'Package in Transit' : 'Order Finalized'}
                  </span>
                </div>
              </div>

              <div className="relative space-y-6">
                <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-white/5" />
                <div 
                  className="absolute left-[19px] top-0 w-[2px] bg-amber-500/50 transition-all duration-1000" 
                  style={{ height: `${(currentStep / (steps.length - 1)) * 100}%` }}
                />

                {steps.map((step, i) => {
                  const active = i <= currentStep;
                  const isCurrent = i === currentStep;
                  return (
                    <div key={step.key} className="relative z-10 flex items-start gap-4">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all duration-500 ${active ? 'bg-amber-500 border-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-black/40 border-white/5 text-slate-800'}`}>
                        <step.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 pt-1">
                        <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${active ? 'text-white' : 'text-slate-700'}`}>{step.label}</p>
                        <p className={`text-[9px] mt-1 italic font-serif leading-tight ${isCurrent ? 'text-amber-500/80' : 'text-slate-600'}`}>
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
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 text-center">Transport Details</h4>
              </div>

              {trade.driverId ? (
                <div className="rounded-2xl bg-black/40 p-5 border border-white/5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                      <Truck className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">Delivery Partner</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest">ID: {trade.driverId.slice(-6)}</p>
                    </div>
                  </div>
                  {trade.deliveryETA && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">Estimated Arrival</span>
                      <span className="text-[8px] font-black uppercase tracking-widest text-amber-500">{trade.deliveryETA}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">Status</span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-green-500">{trade.deliveryStatus || 'Assigned'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">Fee</span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-white">{trade.deliveryFee} CFA</span>
                  </div>
                </div>
              ) : (
                <div className="text-center p-4">
                  <p className="text-[9px] text-slate-600 italic font-serif leading-relaxed uppercase tracking-widest">No transport provider selected yet</p>
                </div>
              )}

              {trade.status === 'funded' && isBuyer && !trade.driverId && (
                <div className="space-y-3">
                  <button 
                    onClick={broadcastRequest}
                    disabled={broadcasting || trade.deliveryRequestStatus === 'open'}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400 disabled:opacity-50"
                  >
                    {broadcasting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Truck className="h-4 w-4" /> {trade.deliveryRequestStatus === 'open' ? 'Request Broadcasted' : 'Broadcast Request'}</>}
                  </button>
                  {trade.deliveryRequestStatus === 'open' && (
                    <p className="text-[8px] text-center text-amber-500/50 uppercase font-black animate-pulse">Waiting for driver to claim...</p>
                  )}
                  <button 
                    onClick={() => setShowDriverSelection(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:bg-white/10"
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
                      <div key={offer.id} className={`rounded-xl p-4 border transition-all ${
                        offer.status === 'pending' ? 'bg-amber-500/5 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]' : 'bg-black/40 border-white/5 opacity-60'
                      } space-y-3`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                            {offer.senderId === user?.uid ? 'Your Offer' : 'Seller Offer'}
                          </span>
                          <span className={`text-[8px] font-black uppercase border px-2 py-0.5 rounded-full ${
                            offer.status === 'accepted' ? 'border-green-500/30 text-green-500 bg-green-500/5' :
                            offer.status === 'declined' ? 'border-red-500/30 text-red-500 bg-red-500/5' :
                            'border-amber-500 text-black bg-amber-500'
                          }`}>
                            {offer.status}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <p className="text-xl font-bold text-white tracking-tight">${offer.amount.toLocaleString()}</p>
                          {offer.status === 'pending' && <p className="text-[8px] text-amber-500/50 uppercase font-black animate-pulse">Active</p>}
                        </div>
                        
                        {offer.status === 'pending' && offer.senderId !== user?.uid && trade.status === 'pending' && (
                          <div className="flex gap-2 pt-2">
                             <button
                              onClick={() => handleOfferResponse(offer.id, 'accepted', offer.amount)}
                              disabled={updating}
                              className="flex-1 rounded-lg bg-white py-2 text-[8px] font-black uppercase text-black hover:bg-amber-500 transition-all"
                            >
                              Accept
                            </button>
                             <button
                               onClick={() => handleOfferResponse(offer.id, 'declined', offer.amount)}
                               disabled={updating}
                               className="flex-1 rounded-lg bg-red-500/10 py-2 text-[8px] font-black uppercase text-red-500 hover:bg-red-500 transition-all"
                             >
                               Decline
                             </button>
                          </div>
                        ) || (offer.status === 'pending' && offer.senderId === user?.uid && (
                          <p className="text-[9px] text-slate-600 italic font-serif leading-none mt-2">Awaiting decision...</p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-slate-600 font-serif italic text-center uppercase tracking-widest">No active offers discovered</p>
                )}

                {trade.status === 'pending' && !showNegotiation ? (
                  <button 
                    onClick={() => setShowNegotiation(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400"
                  >
                    <Scale className="h-4 w-4" /> Propose Terms
                  </button>
                ) : trade.status === 'pending' && (
                  <div className="space-y-3 rounded-2xl bg-white/5 p-4 border border-amber-500/20">
                    <input 
                      type="number"
                      value={newOfferAmount}
                      onChange={(e) => setNewOfferAmount(e.target.value)}
                      placeholder="New Valuation ($)"
                      className="w-full rounded-lg bg-black/40 border border-white/5 px-4 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={submitOffer}
                        disabled={updating || !newOfferAmount}
                        className="flex-1 rounded-lg bg-white py-2 text-[9px] font-black uppercase text-black"
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
                )}
              </div>
            </div>

            <div className="space-y-6 pt-4">
              <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 border-b border-white/5 pb-4 text-center">Order Actions</h4>
              
              {trade.status === 'pending' && isBuyer && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3">
                    <ShieldCheck className="h-4 w-4 text-amber-500 shrink-0" />
                    <p className="text-[9px] text-slate-400 font-serif leading-relaxed italic">
                      Heads up: Your funds will be stored in a secure escrow account and only released when you confirm receipt.
                    </p>
                  </div>
                  <button 
                    onClick={handlePayment} 
                    disabled={updating} 
                    className="w-full flex items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-slate-200 active:scale-[0.98] transition-all"
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
                  <p className="text-[11px] text-slate-500 font-serif italic text-center leading-relaxed">
                    Payment confirmed in escrow. Please arrange delivery and update status once shipped.
                  </p>
                  <button onClick={() => updateStatus('shipped')} disabled={updating} className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400 active:scale-[0.98] transition-all">
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Items Shipped'}
                  </button>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'assigned' && (
                <div className="space-y-4">
                  <p className="text-[11px] text-slate-500 font-serif italic text-center leading-relaxed">You have been assigned this delivery.</p>
                  <div className="flex gap-2">
                    <button onClick={() => updateDeliveryStatus(trade.id, 'accepted')} className="flex-1 rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black">Accept</button>
                    <button onClick={() => updateDeliveryStatus(trade.id, 'rejected')} className="flex-1 rounded-xl bg-red-500/10 border border-red-500/20 py-4 text-[10px] font-black uppercase tracking-widest text-red-500">Reject</button>
                  </div>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'accepted' && (
                <div className="space-y-4">
                  <p className="text-[11px] text-slate-500 font-serif italic text-center leading-relaxed">Proceed to pickup location.</p>
                  <button onClick={() => updateDeliveryStatus(trade.id, 'picked_up')} className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black">Confirm Pick Up</button>
                </div>
              )}

              {isDriver && trade.deliveryStatus === 'picked_up' && (
                <div className="space-y-4">
                  <p className="text-[11px] text-slate-500 font-serif italic text-center leading-relaxed">Deliver items to the buyer.</p>
                  <button onClick={() => updateDeliveryStatus(trade.id, 'delivered')} className="w-full rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black">Confirm Delivery</button>
                </div>
              )}

              {trade.status === 'shipped' && isBuyer && (
                <div className="space-y-4">
                  <p className="text-[11px] text-slate-500 font-serif italic text-center leading-relaxed">
                    Your items are on the way. Confirm below only once you have received and inspected them.
                  </p>
                  <button onClick={() => updateStatus('completed')} disabled={updating} className="w-full rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-slate-200 active:scale-[0.98] transition-all">
                    {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'I Have Received My Order'}
                  </button>
                </div>
              )}

              {trade.status === 'completed' && (
                <div className="space-y-6">
                  <div className="space-y-4 rounded-2xl bg-green-500/5 p-6 border border-green-500/20 text-center">
                    <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                    <p className="font-serif text-lg text-white">Order Completed</p>
                    {!showRating && (
                      <button 
                        onClick={() => setShowRating(true)}
                        className="w-full rounded-xl bg-white/10 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-white/20 transition-all border border-white/5"
                      >
                        Rate this transaction
                      </button>
                    )}
                  </div>

                  <div className="rounded-3xl bg-black/20 p-6 border border-white/5 space-y-4 text-center">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none">Keep the Marketplace Moving</p>
                    <div className="flex flex-col gap-2">
                       <Link 
                        to="/" 
                        className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-[9px] font-bold uppercase tracking-widest text-black hover:bg-amber-500 transition-all"
                      >
                        Browse Similar Items
                      </Link>
                      <Link 
                        to="/create-listing" 
                        className="flex items-center justify-center gap-2 rounded-xl bg-white/5 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-white/10 transition-all"
                      >
                        List your own item
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {trade.status !== 'completed' && trade.status !== 'cancelled' && trade.status !== 'disputed' && (
                <div className="pt-4 border-t border-white/5">
                  <button 
                    onClick={() => updateStatus('disputed')}
                    disabled={updating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-all"
                  >
                    <AlertCircle className="h-4 w-4" /> Need Help? Open a Dispute
                  </button>
                </div>
              )}

              {trade.status === 'disputed' && (
                <div className="space-y-4 rounded-2xl bg-red-500/5 p-6 border border-red-500/20 text-center">
                  <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
                  <p className="font-serif text-lg text-white">Dispute Open</p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest leading-relaxed">Our support team has been notified and will contact you shortly to help resolve this.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showDriverSelection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-lg rounded-[2.5rem] bg-brand-card p-10 border border-white/5 shadow-2xl space-y-8"
            >
              <div className="text-center space-y-3">
                <Truck className="h-10 w-10 text-amber-500 mx-auto" />
                <h2 className="font-serif text-3xl text-white">Select a Driver</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Pick a trusted delivery partner for your trade</p>
              </div>

              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 scrollbar-hide">
                {drivers.length > 0 ? drivers.map(driver => (
                  <button 
                    key={driver.id}
                    onClick={() => assignDriver(driver.id)}
                    className="w-full flex items-center gap-4 p-5 rounded-2xl bg-black/40 border border-white/5 hover:border-amber-500/50 transition-all text-left group"
                  >
                    <div className="h-12 w-12 rounded-full border border-white/10 overflow-hidden">
                      <img src={driver.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`} alt="" />
                    </div>
                    <div className="flex-1">
                      <p className="font-serif text-lg text-white group-hover:text-amber-500">{driver.displayName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">{driver.vehicleType || 'Motorbike'}</span>
                        <div className="h-1 w-1 rounded-full bg-slate-800" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-green-500">{driver.driverStatus}</span>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-700 group-hover:text-amber-500" />
                  </button>
                )) : (
                  <div className="text-center py-10 text-slate-600 uppercase tracking-[0.2em] text-[10px]">No drivers available nearby</div>
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
