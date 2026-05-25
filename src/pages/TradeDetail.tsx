import React, { useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
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
  Navigation,
  Package,
  Scale,
  Send,
  ShieldCheck,
  Smartphone,
  Truck
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { db } from '../lib/firebase';
import { toGeoPoint, type GeoPoint } from '../utils/geoUtils';
import {
  playNotificationSound,
  unlockNotificationSound
} from '../utils/notificationSound';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import DeliveryRequestPanel from '../components/delivery/DeliveryRequestPanel';
import RatingModal from '../components/trade/RatingModal';
import DriverRatingModal from '../components/trade/DriverRatingModal';
import { findOptimalDrivers } from '../services/matchingService';
import {
  CONTACT_BLOCK_ERROR,
  sanitizeContactText,
  sendTradeMessage,
  sendSystemTradeMessage,
  setTradeTyping
} from '../services/chatService';
import { openEscrowDispute } from '../services/escrowService';
import {
  payDeliveryFromWallet,
  payTradeFromWallet,
  releaseTradeEscrow
} from '../services/walletService';

const OperationType = {
  READ: 'read',
  WRITE: 'write',
  UPDATE: 'update',
  DELETE: 'delete',
  SUBSCRIBE: 'subscribe'
} as const;

type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];
type OfferType = 'item' | 'delivery';

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
      case 'failed-precondition':
        return 'This query needs a Firestore index before it can run at scale.';
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

const getMessageMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatMessageTime = (value: any) => {
  const millis = getMessageMillis(value);
  if (!millis) return '';

  return new Date(millis).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
};

interface Trade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status:
    | 'pending'
    | 'funded'
    | 'shipped'
    | 'completed'
    | 'disputed'
    | 'cancelled';
  createdAt: any;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  currencyLabel?: string;
  deliveryPickupAddress?: string;
  deliveryPickupLocation?: GeoPoint | null;
  platformFee?: number;
  deliveryFee?: number;
  driverId?: string;
  driverCommission?: number;
  deliveryStatus?: string;
  deliveryETA?: string;
  deliveryRequestId?: string;
  deliveryRequestStatus?: string;
  deliveryBargainStatus?: string;
  deliveryPaymentStatus?: string;
  deliveryPaymentTxRef?: string;
  deliveryPaymentTransactionId?: string;
  logisticsOrderId?: string;
  escrowStatus?: string;
  paymentStatus?: string;
  paymentTxRef?: string;
  paymentAmount?: number;
  paymentCurrency?: string;
  sellerPayout?: number;
  agreedAmount?: number;
  priceAgreementStatus?: string;
}

interface Listing {
  title: string;
  quantity: string;
  category: string;
  images: string[];
  location?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
}

interface Message {
  id: string;
  tradeId?: string;
  listingId?: string;
  userId?: string;
  senderId: string;
  senderName?: string;
  senderPhotoURL?: string;
  recipientIds?: string[];
  participants?: string[];
  text: string;
  type?: 'user' | 'system';
  status?: string;
  contactVisibleAfterPayment?: boolean;
  readBy?: string[];
  createdAt: any;
  updatedAt?: any;
}

interface Offer {
  id: string;
  senderId: string;
  recipientId?: string;
  amount: number;
  status: 'pending' | 'accepted' | 'declined';
  type?: OfferType;
  createdAt: any;
  updatedAt?: any;
}

interface AppProfile {
  displayName?: string;
  name?: string;
  phoneNumber?: string;
  latitude?: number;
  longitude?: number;
  currentLocation?: {
    latitude?: number;
    longitude?: number;
  };
  location?: string;
  city?: string;
  country?: string;
  photoURL?: string;
}

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  const normalizedCurrency = currencyCode === 'CFA' ? 'XAF' : currencyCode;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: zeroDecimalCurrencies.has(normalizedCurrency) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${normalizedCurrency} ${(amount || 0).toLocaleString()}`;
  }
};

const getTradeCurrency = (trade: Trade | null) =>
  trade?.currencyCode || trade?.currency || 'XAF';

const getTradeLocale = (trade: Trade | null) =>
  trade?.currencyLocale || 'fr-CM';

const formatTradeAmount = (trade: Trade | null, amount?: number) => {
  if (!trade) return formatMoney(amount || 0);

  if (
    typeof amount === 'undefined' &&
    trade.priceDisplay &&
    !trade.agreedAmount &&
    !trade.priceAgreementStatus
  ) {
    return trade.priceDisplay;
  }

  return formatMoney(
    amount ?? trade.amount,
    getTradeCurrency(trade),
    getTradeLocale(trade)
  );
};

const buildDropoffAddress = (profileData: AppProfile | null) =>
  profileData?.location ||
  [profileData?.city, profileData?.country].filter(Boolean).join(', ') ||
  '';

const offerStatusClass = (status: Offer['status']) => {
  if (status === 'accepted') {
    return 'border-green-500/30 bg-green-500/5 text-green-500';
  }

  if (status === 'declined') {
    return 'border-red-500/30 bg-red-500/5 text-red-500';
  }

  return 'border-amber-500 bg-amber-500 text-black';
};

export default function TradeDetail() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const profileData = profile as AppProfile | null;
  const { sendNotification } = useNotifications();

  const [trade, setTrade] = useState<
    (Trade & { typing?: Record<string, boolean> }) | null
  >(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [newOfferAmount, setNewOfferAmount] = useState('');
  const [newDeliveryOfferAmount, setNewDeliveryOfferAmount] = useState('');
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [showDeliveryNegotiation, setShowDeliveryNegotiation] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatSource, setChatSource] = useState<'flat' | 'legacy'>('flat');
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showDriverRating, setShowDriverRating] = useState(false);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [showDriverSelection, setShowDriverSelection] = useState(false);
  const [showDeliveryRequestPanel, setShowDeliveryRequestPanel] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSoundMessageIdRef = useRef<string | null>(null);

  const isBuyer = Boolean(user?.uid && trade?.buyerId && user.uid === trade.buyerId);
  const isSeller = Boolean(user?.uid && trade?.sellerId && user.uid === trade.sellerId);
  const isDriver = Boolean(user?.uid && trade?.driverId && user.uid === trade.driverId);

  const tradeRecipientIds = trade
    ? [trade.buyerId, trade.sellerId, trade.driverId || ''].filter(Boolean)
    : [];

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const unlock = () => unlockNotificationSound();

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const latest = messages[messages.length - 1];

    if (!latest || !user) return;

    const alreadyPlayed = lastSoundMessageIdRef.current === latest.id;
    const isIncoming = latest.senderId !== user.uid && latest.senderId !== 'system';

    if (!alreadyPlayed && isIncoming) {
      playNotificationSound();
    }

    lastSoundMessageIdRef.current = latest.id;
  }, [messages, user]);

  const setTypingStatus = async (isTyping: boolean) => {
    if (!id || !user) return;

    try {
      await setTradeTyping(id, user.uid, isTyping);
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

  const requestWalletPin = () => {
    const pin = window.prompt('Enter your Hema Wallet PIN to authorize this transaction.');

    if (!pin) return null;

    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      alert('Wallet PIN must be 4 or 6 digits.');
      return null;
    }

    return pin;
  };

  const handlePayment = async () => {
    if (!trade || !user || !isBuyer) return;

    const walletPin = requestWalletPin();
    if (!walletPin) return;

    setUpdating(true);

    try {
      await payTradeFromWallet(user, trade.id, walletPin);

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: `Buyer funded item escrow from Hema Wallet for ${listing?.title || 'this order'}. Seller can now prepare the item.`,
        recipientIds: [trade.buyerId, trade.sellerId],
        sendNotification,
        title: 'Escrow Funded'
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not pay from Hema Wallet.');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeliveryPayment = async () => {
    if (!trade || !user || !isBuyer) return;

    if (!trade.driverId || !trade.deliveryFee) {
      alert('Agree on a delivery fee with the driver first.');
      return;
    }

    const walletPin = requestWalletPin();
    if (!walletPin) return;

    setUpdating(true);

    try {
      await payDeliveryFromWallet(user, trade.id, walletPin);

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: `Delivery escrow funded from Hema Wallet: ${formatMoney(trade.deliveryFee || 0, 'XAF', 'fr-CM')}. Driver can now proceed to pickup after coordination.`,
        recipientIds: [trade.buyerId, trade.sellerId, trade.driverId],
        sendNotification,
        title: 'Delivery Escrow Funded'
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not pay delivery from Hema Wallet.');
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    let isMounted = true;
    let unsubscribeLegacyChat: (() => void) | null = null;

    setLoading(true);
    setError(null);
    setChatSource('flat');

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

    const subscribeToLegacyMessages = () => {
      if (unsubscribeLegacyChat) return;

      setChatSource('legacy');

      unsubscribeLegacyChat = onSnapshot(
        query(
          collection(db, 'trades', id, 'messages'),
          orderBy('createdAt', 'asc'),
          limit(50)
        ),
        snapshot => {
          if (isMounted) {
            setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
          }
        },
        err => handleFirestoreError(err, OperationType.SUBSCRIBE, `trades/${id}/messages`)
      );
    };

    const unsubscribeChat = onSnapshot(
      query(
        collection(db, 'messages'),
        where('tradeId', '==', id),
        limit(50)
      ),
      snapshot => {
        if (isMounted) {
          const sortedMessages = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() } as Message))
            .sort((a, b) => getMessageMillis(a.createdAt) - getMessageMillis(b.createdAt));

          setChatSource('flat');
          setMessages(sortedMessages);
        }
      },
      err => {
        const message = handleFirestoreError(err, OperationType.SUBSCRIBE, `messages?tradeId=${id}`);
        console.warn('Flat message listener failed. Falling back to legacy trade messages:', message);
        subscribeToLegacyMessages();
      }
    );

    const unsubscribeOffers = onSnapshot(
      query(collection(db, 'trades', id, 'offers'), orderBy('createdAt', 'desc')),
      snapshot => {
        if (isMounted) {
          setOffers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Offer)));
        }
      },
      err => handleFirestoreError(err, OperationType.SUBSCRIBE, `trades/${id}/offers`)
    );

    const unsubscribeDrivers = onSnapshot(
      query(collection(db, 'users'), where('roles', 'array-contains', 'driver')),
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
      unsubscribeLegacyChat?.();
      unsubscribeOffers();
      unsubscribeDrivers();
    };
  }, [id]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const canDriverShareContact =
    Boolean(trade?.driverId) &&
    isDriver &&
    trade?.deliveryPaymentStatus === 'paid';

  const canBuyerViewDriverContact =
    Boolean(trade?.driverId) &&
    isBuyer &&
    trade?.deliveryPaymentStatus === 'paid';

  const canRevealContactMessage = (message: Message) =>
    Boolean(trade?.driverId) &&
    trade?.deliveryPaymentStatus === 'paid' &&
    message.senderId === trade.driverId &&
    Boolean(message.contactVisibleAfterPayment) &&
    (canBuyerViewDriverContact || isDriver);

  const getVisibleMessageText = (message: Message) =>
    canRevealContactMessage(message)
      ? message.text
      : sanitizeContactText(message.text);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!id || !newMessage.trim() || !user || !trade) return;

    const text = newMessage.trim();
    const senderName =
      profileData?.displayName ||
      profileData?.name ||
      user.displayName ||
      'Marketplace User';

    setNewMessage('');
    setTypingStatus(false);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    try {
      await sendTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        senderId: user.uid,
        senderName,
        senderPhotoURL: profileData?.photoURL || user.photoURL || '',
        text,
        recipientIds: [trade.buyerId, trade.sellerId, trade.driverId || ''],
        sendNotification,
        allowContactInfo: canDriverShareContact
      });
    } catch (err) {
      if (err instanceof Error && err.name === CONTACT_BLOCK_ERROR) {
        alert(
          isDriver
            ? 'You can share your phone number only after the buyer pays the delivery fee.'
            : err.message
        );
        return;
      }

      handleFirestoreError(err, OperationType.WRITE, `messages/${id}`);
    }
  };

  const handleConfirmDelivery = async () => {
    if (!trade || !user || !isBuyer) return;

    const walletPin = requestWalletPin();
    if (!walletPin) return;

    setUpdating(true);

    try {
      await releaseTradeEscrow(user, trade.id, walletPin);

      try {
        const soldExpiresAt = Timestamp.fromDate(
          new Date(Date.now() + 24 * 60 * 60 * 1000)
        );

        await updateDoc(doc(db, 'listings', trade.listingId), {
          status: 'sold',
          stockStatus: 'sold',
          soldAt: serverTimestamp(),
          soldExpiresAt,
          soldByTradeId: trade.id,
          updatedAt: serverTimestamp()
        });

        await sendSystemTradeMessage({
          tradeId: trade.id,
          listingId: trade.listingId,
          text: 'Buyer confirmed delivery. Escrow released to the seller and driver Hema Wallet balances.',
          recipientIds: tradeRecipientIds,
          sendNotification,
          title: 'Escrow Released'
        });
      } catch (postReleaseError) {
        handleFirestoreError(postReleaseError, OperationType.UPDATE, `trades/${trade.id}/post-release-ui`);
      }

      setShowRating(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not release escrow. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const markListingInStock = async () => {
    if (!trade || !isSeller) return;

    setUpdating(true);

    try {
      await updateDoc(doc(db, 'listings', trade.listingId), {
        status: 'active',
        stockStatus: 'in_stock',
        soldAt: null,
        soldExpiresAt: null,
        soldByTradeId: null,
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: 'Seller marked this product as back in stock.',
        recipientIds: [trade.buyerId, trade.sellerId],
        sendNotification,
        title: 'Back In Stock'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `listings/${trade.listingId}/stock`);
      alert('Could not mark this product as in stock.');
    } finally {
      setUpdating(false);
    }
  };

  const handleCancelTrade = async () => {
    if (!trade || !user || (!isBuyer && !isSeller)) return;

    const confirmed = window.confirm(
      'Cancel this pending trade? No escrow payment has been made, and the product will stay available.'
    );

    if (!confirmed) return;

    setUpdating(true);

    try {
      await updateDoc(doc(db, 'trades', trade.id), {
        status: 'cancelled',
        cancellationReason: 'Buyer or seller cancelled during bargaining.',
        cancelledBy: user.uid,
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'listings', trade.listingId), {
        status: 'active',
        stockStatus: 'in_stock',
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: 'This trade was cancelled during bargaining. No escrow payment was made.',
        recipientIds: [trade.buyerId, trade.sellerId],
        sendNotification,
        title: 'Trade Cancelled'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${trade.id}/cancel`);
      alert('Could not cancel this trade. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleOpenDispute = async () => {
    if (!trade || !user) return;

    setUpdating(true);

    try {
      await openEscrowDispute({
        tradeId: trade.id,
        userId: user.uid,
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        reason: 'User requested support from trade page.',
        sendNotification
      });

      await sendSystemTradeMessage({
        tradeId: trade.id,
        listingId: trade.listingId,
        text: 'A dispute has been opened. Our support team is joining the conversation to help.',
        recipientIds: tradeRecipientIds,
        sendNotification,
        title: 'Dispute Opened'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${trade.id}/dispute`);
      alert('Could not open dispute. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const updateStatus = async (
    newStatus: Trade['status'],
    extras: Record<string, any> = {}
  ) => {
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
        updates.escrowStatus = 'funded';
      }

      await updateDoc(doc(db, 'trades', id), updates);

      let notificationTitle = 'Order Update';
      let systemMessage = '';

      if (newStatus === 'funded') {
        notificationTitle = 'Payment Secured';
        systemMessage = 'Payment secured in escrow. Buyer can now choose a delivery driver.';
      } else if (newStatus === 'shipped') {
        notificationTitle = 'Package Shipped';
        systemMessage = 'Items are on the way. Buyer: confirm here once they arrive so we can release the funds.';
      }

      if (systemMessage) {
        await sendSystemTradeMessage({
          tradeId: id,
          listingId: trade.listingId,
          text: systemMessage,
          recipientIds: tradeRecipientIds,
          sendNotification,
          title: notificationTitle
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

    if (!isBuyer && !isSeller) return;

    const amount = Number(newOfferAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setUpdating(true);

    try {
      const recipientId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;

      await addDoc(collection(db, 'trades', id, 'offers'), {
        type: 'item',
        senderId: user.uid,
        recipientId,
        amount,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        text: `New item price offer: ${formatTradeAmount(trade, amount)}. Awaiting response inside Hema Trader.`,
        recipientIds: [trade.buyerId, trade.sellerId],
        sendNotification,
        title: 'New Price Offer'
      });

      await sendNotification(recipientId, {
        title: 'New Price Offer',
        body: `${profileData?.displayName || profileData?.name || 'User'} proposed ${formatTradeAmount(trade, amount)}`,
        type: 'offer',
        targetId: id,
        targetType: 'trade',
        actionUrl: `/trade/${id}`
      });

      setNewOfferAmount('');
      setShowNegotiation(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `trades/${id}/offers`);
    } finally {
      setUpdating(false);
    }
  };

  const submitDeliveryOffer = async () => {
    if (!id || !user || !newDeliveryOfferAmount || !trade?.driverId) return;

    if (!isBuyer && !isDriver) return;

    const amount = Number(newDeliveryOfferAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const recipientId = isBuyer ? trade.driverId : trade.buyerId;

    setUpdating(true);

    try {
      await addDoc(collection(db, 'trades', id, 'offers'), {
        type: 'delivery',
        senderId: user.uid,
        recipientId,
        amount,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'trades', id), {
        deliveryBargainStatus: 'negotiating',
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        text: `New delivery fee offer: ${formatMoney(amount, 'XAF', 'fr-CM')}. Awaiting response inside Hema Trader.`,
        recipientIds: [trade.buyerId, trade.sellerId, trade.driverId],
        sendNotification,
        title: 'Delivery Fee Offer'
      });

      await sendNotification(recipientId, {
        title: 'Delivery Fee Offer',
        body: `${profileData?.displayName || profileData?.name || 'User'} proposed ${formatMoney(amount, 'XAF', 'fr-CM')} for delivery.`,
        type: 'delivery',
        targetId: id,
        targetType: 'trade',
        actionUrl: `/trade/${id}`
      });

      setNewDeliveryOfferAmount('');
      setShowDeliveryNegotiation(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `trades/${id}/delivery-offers`);
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

      if (!offerSnap.exists()) throw new Error('Offer not found.');

      const offerData = offerSnap.data() as Offer;
      const offerType: OfferType = offerData.type || 'item';
      const offerSenderId = offerData.senderId;
      const recipientId = offerData.recipientId;

      if (offerSenderId === user.uid) {
        throw new Error('You cannot respond to your own offer.');
      }

      if (recipientId && recipientId !== user.uid) {
        throw new Error('Only the offer recipient can respond.');
      }

      await updateDoc(offerRef, {
        status,
        updatedAt: serverTimestamp()
      });

      if (status === 'accepted' && offerType === 'item') {
        await updateDoc(doc(db, 'trades', id), {
          amount,
          agreedAmount: amount,
          priceAgreementStatus: 'accepted',
          updatedAt: serverTimestamp()
        });
      }

      if (status === 'accepted' && offerType === 'delivery') {
        await updateDoc(doc(db, 'trades', id), {
          deliveryFee: amount,
          driverCommission: amount * 0.8,
          deliveryBargainStatus: 'accepted',
          deliveryPaymentStatus: 'pending',
          updatedAt: serverTimestamp()
        });
      }

      if (offerSenderId && offerSenderId !== user.uid) {
        await sendNotification(offerSenderId, {
          title: `${offerType === 'delivery' ? 'Delivery' : 'Price'} Offer ${
            status === 'accepted' ? 'Accepted' : 'Declined'
          }`,
          body:
            offerType === 'delivery'
              ? `Your delivery offer of ${formatMoney(amount, 'XAF', 'fr-CM')} has been ${status}.`
              : `Your item offer of ${formatTradeAmount(trade, amount)} has been ${status}.`,
          type: offerType === 'delivery' ? 'delivery' : 'offer',
          targetId: id,
          targetType: 'trade',
          actionUrl: `/trade/${id}`
        });
      }

      await sendSystemTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        text:
          offerType === 'delivery'
            ? `Delivery offer for ${formatMoney(amount, 'XAF', 'fr-CM')} ${status}. ${
                status === 'accepted' ? 'Buyer can now pay the delivery fee from Hema Wallet.' : 'You may submit another delivery offer.'
              }`
            : `Item price offer for ${formatTradeAmount(trade, amount)} ${status}. ${
                status === 'accepted' ? 'Buyer can now fund escrow from Hema Wallet.' : 'You may submit another item offer.'
              }`,
        recipientIds: [trade.buyerId, trade.sellerId, trade.driverId || ''],
        sendNotification,
        title: `${offerType === 'delivery' ? 'Delivery' : 'Price'} Offer ${
          status === 'accepted' ? 'Accepted' : 'Declined'
        }`
      });
    } catch (err) {
      const message = handleFirestoreError(err, OperationType.UPDATE, `trades/${id}/offers/${offerId}`);
      alert(message);
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

      await updateDoc(doc(db, 'trades', id), {
        deliveryRequestStatus: 'open',
        deliveryBargainStatus: 'driver_search',
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        text: `Delivery request broadcasted to ${bestDrivers.length} nearby drivers. The selected driver must accept, then delivery fee bargaining begins.`,
        recipientIds: [trade.buyerId, trade.sellerId],
        sendNotification,
        title: 'Delivery Broadcast Sent'
      });

      await Promise.all(
        bestDrivers.map(driver =>
          sendNotification(driver.id, {
            title: 'New Delivery Opportunity',
            body: `Nearby delivery request for ${listing?.title || 'an order'}. Open the trade to accept and negotiate delivery fee.`,
            type: 'delivery',
            targetId: id,
            targetType: 'trade',
            actionUrl: `/trade/${id}`
          })
        )
      );
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
      await updateDoc(doc(db, 'trades', id), {
        driverId,
        deliveryStatus: 'assigned',
        deliveryRequestStatus: 'assigned',
        deliveryBargainStatus: 'awaiting_driver_acceptance',
        deliveryFee: 0,
        driverCommission: 0,
        deliveryPaymentStatus: 'unpaid',
        updatedAt: serverTimestamp()
      });

      await sendSystemTradeMessage({
        tradeId: id,
        listingId: trade.listingId,
        text: 'Driver selected. Driver must accept the request before buyer and driver negotiate delivery fee.',
        recipientIds: [trade.buyerId, trade.sellerId, driverId],
        sendNotification,
        title: 'Driver Selected'
      });

      await sendNotification(driverId, {
        title: 'Delivery Request',
        body: `Buyer selected you for ${listing?.title || 'an order'}. Accept the request to begin delivery fee bargaining.`,
        type: 'delivery',
        targetId: id,
        targetType: 'trade',
        actionUrl: `/trade/${id}`
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

    if (newStatus === 'picked_up' && trade.deliveryPaymentStatus !== 'paid') {
      alert('Delivery fee must be paid before pickup can begin.');
      return;
    }

    setUpdating(true);

    try {
      const updates: Record<string, any> = {
        deliveryStatus: newStatus,
        updatedAt: serverTimestamp()
      };

      if (newStatus === 'accepted') {
        updates.deliveryBargainStatus = 'negotiating_delivery_fee';
      }

      if (newStatus === 'rejected') {
        updates.driverId = '';
        updates.deliveryBargainStatus = 'rejected';
        updates.deliveryRequestStatus = 'driver_rejected';
        updates.deliveryFee = 0;
        updates.driverCommission = 0;
        updates.deliveryPaymentStatus = 'unpaid';
      }

      await updateDoc(doc(db, 'trades', tradeId), updates);

      let message = '';

      if (newStatus === 'accepted') {
        message = 'Driver accepted the delivery request. Buyer and driver can now bargain delivery fee inside Hema Trader.';
      }

      if (newStatus === 'picked_up') {
        message = 'Driver confirmed pickup. Items are now in transit.';
      }

      if (newStatus === 'delivered') {
        message = 'Driver confirmed delivery. Buyer should inspect and confirm receipt.';
      }

      if (newStatus === 'rejected') {
        message = 'Driver declined delivery. Buyer can select another available driver.';
      }

      if (message) {
        await sendSystemTradeMessage({
          tradeId,
          listingId: trade.listingId,
          text: message,
          recipientIds: [trade.buyerId, trade.sellerId, trade.driverId || ''],
          sendNotification,
          title: 'Delivery Update'
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

  const canSelectDriver =
    Boolean(trade && user) &&
    isBuyer &&
    trade?.status === 'funded' &&
    !trade?.driverId;

  const canRequestAdvancedDelivery =
    Boolean(trade && user) &&
    isBuyer &&
    trade?.status === 'funded' &&
    !trade?.deliveryRequestId;

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
        <h2 className="mb-4 font-serif text-3xl text-white">
          Order details unavailable
        </h2>
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

  const itemOffers = offers.filter(offer => (offer.type || 'item') === 'item');
  const deliveryOffers = offers.filter(offer => offer.type === 'delivery');
  const pendingItemOffer = itemOffers.find(offer => offer.status === 'pending');
  const pendingDeliveryOffer = deliveryOffers.find(offer => offer.status === 'pending');

  const canBuyerPayItem =
    isBuyer &&
    trade.status === 'pending' &&
    !pendingItemOffer;

  const canCancelPendingTrade =
    trade.status === 'pending' &&
    (isBuyer || isSeller);

  const canNegotiateDelivery =
    Boolean(trade.driverId) &&
    trade.deliveryStatus === 'accepted' &&
    trade.deliveryPaymentStatus !== 'paid' &&
    (isBuyer || isDriver);

  const canPayDelivery =
    isBuyer &&
    Number(trade.deliveryFee || 0) > 0 &&
    trade.deliveryBargainStatus === 'accepted' &&
    trade.deliveryPaymentStatus !== 'paid';

  const canDriverPickup =
    isDriver &&
    trade.deliveryStatus === 'accepted' &&
    trade.deliveryPaymentStatus === 'paid';

  const availableDrivers = drivers.filter(driver => {
    if (driver.id === user?.uid) return false;
    return driver.driverStatus === 'available' || driver.isOnline || driver.online;
  });

  const steps = [
    {
      key: 'pending',
      label: 'Bargain',
      description: 'Buyer and seller agree on item price',
      icon: Scale
    },
    {
      key: 'funded',
      label: 'Escrow',
      description: 'Buyer funds escrow from Hema Wallet',
      icon: ShieldCheck
    },
    {
      key: 'delivery',
      label: 'Delivery',
      description: 'Choose driver, bargain fee, and track movement',
      icon: Truck
    },
    {
      key: 'completed',
      label: 'Finalized',
      description:
        trade.escrowStatus === 'release_pending_server_payout'
          ? 'Delivery confirmed. Payout is queued securely.'
          : 'Trade closed and wallet funds released',
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

  if (trade.status === 'cancelled') {
    steps.push({
      key: 'cancelled',
      label: 'Cancelled',
      description: 'Trade closed before escrow payment',
      icon: AlertCircle
    });
  }

  const rawStep =
    trade.status === 'disputed' || trade.status === 'cancelled'
      ? steps.length - 1
      : trade.status === 'completed'
        ? 3
        : trade.status === 'shipped' || trade.driverId
          ? 2
          : trade.status === 'funded'
            ? 1
            : 0;

  const currentStep = rawStep >= 0 ? rawStep : 0;
  const stepProgress =
    steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0;

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
            {trade.escrowStatus && (
              <p className="mt-2 text-[8px] font-black uppercase tracking-widest text-amber-500">
                Escrow: {trade.escrowStatus.replaceAll('_', ' ')}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
              Item: {formatTradeAmount(trade)}
            </p>
            {trade.deliveryFee ? (
              <p className="mt-1 text-[8px] font-bold uppercase tracking-wider text-green-500">
                Delivery: {formatMoney(trade.deliveryFee, 'XAF', 'fr-CM')}
              </p>
            ) : null}
            <p className="mt-1 text-[8px] font-bold uppercase tracking-wider text-slate-700">
              ID: {trade.id.slice(-6).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          {canBuyerPayItem && (
            <button
              onClick={handlePayment}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl disabled:opacity-50"
            >
              {updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-4 w-4" />
                  Pay From Wallet
                </>
              )}
            </button>
          )}

          {pendingItemOffer && trade.status === 'pending' && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-center text-[10px] uppercase tracking-widest text-amber-500">
              Waiting for price offer response
            </div>
          )}

          {canCancelPendingTrade && (
            <button
              onClick={handleCancelTrade}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 py-5 text-[10px] font-bold uppercase tracking-widest text-red-500 shadow-2xl disabled:opacity-50"
            >
              <AlertCircle className="h-4 w-4" />
              Cancel Trade
            </button>
          )}

          {canSelectDriver && (
            <button
              onClick={() => setShowDriverSelection(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl"
            >
              <Truck className="h-4 w-4" />
              Choose Driver
            </button>
          )}

          {canPayDelivery && (
            <button
              onClick={handleDeliveryPayment}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-green-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              Pay Delivery From Wallet
            </button>
          )}

          {trade.deliveryRequestId && (
            <Link
              to={`/delivery/${trade.deliveryRequestId}`}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-green-500/30 bg-green-500/10 py-5 text-[10px] font-bold uppercase tracking-widest text-green-400 shadow-2xl"
            >
              <Navigation className="h-4 w-4" />
              Live Tracking
            </Link>
          )}

          {trade.status === 'funded' && isSeller && (
            <button
              onClick={() => updateStatus('shipped')}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl disabled:opacity-50"
            >
              {updating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Package className="h-4 w-4" />
                  Mark as Ready
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
                Accept
              </button>
              <button
                onClick={() => updateDeliveryStatus(trade.id, 'rejected')}
                className="flex-1 rounded-2xl bg-red-500 py-5 text-[10px] font-bold uppercase tracking-widest text-white shadow-2xl"
              >
                Reject
              </button>
            </div>
          )}

          {canDriverPickup && (
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
              onClick={handleConfirmDelivery}
              disabled={updating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl disabled:opacity-50"
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
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.01] p-6">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-4 w-4 text-amber-500" />
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Protected Chat
              </h3>
            </div>

            <span className="rounded-full border border-white/5 bg-white/[0.03] px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-600">
              {chatSource === 'flat' ? 'Scaled Chat' : 'Legacy Chat'}
            </span>
          </div>

          <div className="scrollbar-hide flex-1 space-y-6 overflow-y-auto p-6">
            {messages.length < 10 && trade.status === 'pending' && (
              <div className="mb-6 space-y-3 rounded-3xl border border-amber-500/10 bg-amber-500/5 p-6 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                    Chat, Bargain, Stay Protected
                  </p>
                  <p className="mt-1 font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Contact details stay blocked until delivery is paid. Then only the assigned driver may share a phone number with the buyer.
                  </p>
                </div>
              </div>
            )}

            {messages.map(message => {
              const isMine = message.senderId === user?.uid;
              const isSystem = message.senderId === 'system' || message.type === 'system';

              if (isSystem) {
                return (
                  <div key={message.id} className="flex justify-center">
                    <div className="max-w-[85%] rounded-2xl border border-amber-500/10 bg-amber-500/5 px-5 py-3 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                        Hema Trader
                      </p>
                      <p className="mt-1 font-serif text-[11px] italic leading-relaxed text-slate-400">
                        {getVisibleMessageText(message)}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={message.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl border px-5 py-3 shadow-2xl ${
                      isMine
                        ? 'rounded-tr-none border-amber-500/20 bg-amber-500/10 text-white'
                        : 'rounded-tl-none border-white/5 bg-white/5 text-slate-300'
                    }`}
                  >
                    {!isMine && message.senderName && (
                      <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                        {message.senderName}
                      </p>
                    )}
                    <p className="font-serif text-sm leading-relaxed">
                      {getVisibleMessageText(message)}
                    </p>
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
              {[
                'Is this available?',
                'Can delivery be arranged?',
                'Can you share item condition?',
                'I want to bargain'
              ].map(text => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setNewMessage(text)}
                  className="whitespace-nowrap rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-500 transition-all hover:border-amber-500/30 hover:text-white"
                >
                  {text}
                </button>
              ))}

              {canDriverShareContact && profileData?.phoneNumber && (
                <button
                  type="button"
                  onClick={() => setNewMessage(`Delivery contact: ${profileData.phoneNumber}`)}
                  className="whitespace-nowrap rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-[8px] font-bold uppercase tracking-widest text-green-400 transition-all hover:bg-green-500 hover:text-black"
                >
                  Share Delivery Phone
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={newMessage}
                onChange={e => {
                  setNewMessage(e.target.value);
                  handleTyping();
                }}
                placeholder={
                  canDriverShareContact
                    ? 'You may share your delivery phone with the buyer...'
                    : 'Type a message. Contact details are blocked...'
                }
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

        <div className="hidden w-80 shrink-0 flex-col gap-6 overflow-y-auto lg:flex">
          <div className="space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
            <div className="space-y-6">
              <div className="flex flex-col items-center space-y-2 border-b border-white/5 pb-6 text-center">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                  Trade Flow
                </h4>
                <div className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  <span className="text-[8px] font-bold uppercase tracking-widest text-amber-500">
                    {trade.status === 'pending'
                      ? 'Bargaining Item Price'
                      : trade.status === 'funded'
                        ? trade.driverId
                          ? 'Delivery Setup'
                          : 'Choose Driver'
                        : trade.status === 'shipped'
                          ? 'In Transit'
                          : trade.status === 'disputed'
                            ? 'Dispute Open'
                            : trade.status === 'cancelled'
                              ? 'Cancelled'
                              : 'Finalized'}
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

            <div className="space-y-4 border-t border-white/5 pt-6">
              <h4 className="text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                Item Bargain
              </h4>

              {itemOffers.length > 0 ? (
                <div className="space-y-3">
                  {itemOffers.slice(0, 4).map(offer => (
                    <div
                      key={offer.id}
                      className="space-y-3 rounded-xl border border-white/5 bg-black/40 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                          {offer.senderId === user?.uid ? 'Your Offer' : 'Peer Offer'}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${offerStatusClass(offer.status)}`}
                        >
                          {offer.status}
                        </span>
                      </div>

                      <p className="text-xl font-bold tracking-tight text-white">
                        {formatTradeAmount(trade, offer.amount)}
                      </p>

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
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center font-serif text-[9px] italic uppercase tracking-widest text-slate-600">
                  No item offers yet
                </p>
              )}

              {trade.status === 'pending' && !showNegotiation ? (
                <button
                  onClick={() => setShowNegotiation(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400"
                >
                  <Scale className="h-4 w-4" />
                  {isBuyer ? 'Make Price Offer' : 'Counter Price'}
                </button>
              ) : trade.status === 'pending' ? (
                <div className="space-y-3 rounded-2xl border border-amber-500/20 bg-white/5 p-4">
                  <input
                    type="number"
                    min="1"
                    value={newOfferAmount}
                    onChange={e => setNewOfferAmount(e.target.value)}
                    placeholder={`Offer Amount (${getTradeCurrency(trade)})`}
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

              {canBuyerPayItem ? (
                <button
                  onClick={handlePayment}
                  disabled={updating}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-slate-200 active:scale-[0.98] disabled:opacity-50"
                >
                  {updating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Smartphone className="h-4 w-4" />
                      Pay From Wallet
                    </>
                  )}
                </button>
              ) : null}

              {pendingItemOffer && trade.status === 'pending' && (
                <p className="text-center text-[8px] font-black uppercase tracking-widest text-amber-500/70">
                  Payment unlocks after pending offer is answered.
                </p>
              )}

              {canCancelPendingTrade && (
                <button
                  onClick={handleCancelTrade}
                  disabled={updating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 transition-all hover:bg-red-500/20 disabled:opacity-50"
                >
                  <AlertCircle className="h-4 w-4" />
                  Cancel Trade
                </button>
              )}
            </div>

            <div className="space-y-4 border-t border-white/5 pt-6">
              <h4 className="text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                Delivery
              </h4>

              {trade.status !== 'funded' &&
              trade.status !== 'shipped' &&
              trade.status !== 'completed' &&
              trade.status !== 'cancelled' ? (
                <p className="text-center font-serif text-[9px] italic uppercase leading-relaxed tracking-widest text-slate-600">
                  Driver selection unlocks after buyer funds item escrow.
                </p>
              ) : null}

              {trade.driverId ? (
                <div className="space-y-4 rounded-2xl border border-white/5 bg-black/40 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
                      <Truck className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">
                        Selected Driver
                      </p>
                      <p className="text-[9px] uppercase tracking-widest text-slate-500">
                        ID: {trade.driverId.slice(-6)}
                      </p>
                    </div>
                  </div>

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
                      {formatMoney(trade.deliveryFee || 0, 'XAF', 'fr-CM')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                      Payment
                    </span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                      {trade.deliveryPaymentStatus || 'unpaid'}
                    </span>
                  </div>

                  {canDriverShareContact && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-center text-[8px] font-black uppercase leading-relaxed tracking-widest text-green-400">
                      Delivery is paid. You can now share your phone number with the buyer in chat.
                    </div>
                  )}

                  {canBuyerViewDriverContact && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-center text-[8px] font-black uppercase leading-relaxed tracking-widest text-green-400">
                      Delivery is paid. The assigned driver may share their phone number here.
                    </div>
                  )}
                </div>
              ) : null}

              {canSelectDriver && (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowDriverSelection(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400"
                  >
                    <Truck className="h-4 w-4" />
                    Choose Available Driver
                  </button>

                  <button
                    onClick={broadcastRequest}
                    disabled={broadcasting || trade.deliveryRequestStatus === 'open'}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:bg-white/10 disabled:opacity-50"
                  >
                    {broadcasting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Truck className="h-4 w-4" />
                        {trade.deliveryRequestStatus === 'open'
                          ? 'Broadcast Sent'
                          : 'Broadcast Request'}
                      </>
                    )}
                  </button>
                </div>
              )}

              {canRequestAdvancedDelivery && (
                <button
                  onClick={() => setShowDeliveryRequestPanel(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 py-3 text-[10px] font-black uppercase tracking-widest text-green-400 hover:bg-green-500 hover:text-black"
                >
                  <Navigation className="h-4 w-4" />
                  Advanced Delivery Form
                </button>
              )}

              {isDriver && trade.deliveryStatus === 'assigned' && (
                <div className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
                  <p className="text-center font-serif text-[11px] italic leading-relaxed text-slate-500">
                    Buyer selected you for this delivery. Accept first, then negotiate your fee.
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

              {canNegotiateDelivery && (
                <div className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-center text-[9px] font-black uppercase tracking-widest text-amber-500">
                    Delivery Fee Bargain
                  </p>

                  {deliveryOffers.length > 0 ? (
                    <div className="space-y-3">
                      {deliveryOffers.slice(0, 4).map(offer => (
                        <div
                          key={offer.id}
                          className="space-y-3 rounded-xl border border-white/5 bg-black/40 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                              {offer.senderId === user?.uid ? 'Your Offer' : 'Peer Offer'}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${offerStatusClass(offer.status)}`}
                            >
                              {offer.status}
                            </span>
                          </div>

                          <p className="text-xl font-bold tracking-tight text-white">
                            {formatMoney(offer.amount, 'XAF', 'fr-CM')}
                          </p>

                          {offer.status === 'pending' && offer.senderId !== user?.uid && (
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
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center font-serif text-[9px] italic uppercase tracking-widest text-slate-600">
                      No delivery fee offers yet
                    </p>
                  )}

                  {!showDeliveryNegotiation ? (
                    <button
                      onClick={() => setShowDeliveryNegotiation(true)}
                      disabled={Boolean(pendingDeliveryOffer)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-amber-400 disabled:opacity-50"
                    >
                      <Scale className="h-4 w-4" />
                      {isBuyer ? 'Offer Delivery Fee' : 'Counter Delivery Fee'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="number"
                        min="1"
                        value={newDeliveryOfferAmount}
                        onChange={e => setNewDeliveryOfferAmount(e.target.value)}
                        placeholder="Delivery fee in XAF"
                        className="w-full rounded-lg border border-white/5 bg-black/40 px-4 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={submitDeliveryOffer}
                          disabled={updating || !newDeliveryOfferAmount}
                          className="flex-1 rounded-lg bg-white py-2 text-[9px] font-black uppercase text-black disabled:opacity-50"
                        >
                          Submit
                        </button>
                        <button
                          onClick={() => setShowDeliveryNegotiation(false)}
                          className="rounded-lg bg-white/5 px-4 py-2 text-[9px] font-black uppercase text-slate-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canPayDelivery && (
                <button
                  onClick={handleDeliveryPayment}
                  disabled={updating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl hover:bg-green-400 disabled:opacity-50"
                >
                  <CreditCard className="h-4 w-4" />
                  Pay Delivery From Wallet
                </button>
              )}

              {canDriverPickup && (
                <button
                  onClick={() => updateDeliveryStatus(trade.id, 'picked_up')}
                  className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                >
                  Confirm Pick Up
                </button>
              )}

              {isDriver && trade.deliveryStatus === 'picked_up' && (
                <button
                  onClick={() => updateDeliveryStatus(trade.id, 'delivered')}
                  className="w-full rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black"
                >
                  Confirm Delivery
                </button>
              )}

              {trade.deliveryRequestId && (
                <Link
                  to={`/delivery/${trade.deliveryRequestId}`}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 py-3 text-[10px] font-black uppercase tracking-widest text-green-400 hover:bg-green-500 hover:text-black"
                >
                  <Navigation className="h-4 w-4" />
                  Live Tracking
                </Link>
              )}
            </div>

            <div className="space-y-4 border-t border-white/5 pt-6">
              <h4 className="text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">
                Final Actions
              </h4>

              {trade.status === 'funded' && isSeller && (
                <button
                  onClick={() => updateStatus('shipped')}
                  disabled={updating}
                  className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-amber-400 active:scale-[0.98] disabled:opacity-50"
                >
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Item Ready / Shipped'}
                </button>
              )}

              {trade.status === 'shipped' && isBuyer && (
                <button
                  onClick={handleConfirmDelivery}
                  disabled={updating}
                  className="w-full rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-slate-200 active:scale-[0.98] disabled:opacity-50"
                >
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'I Have Received My Order'}
                </button>
              )}

              {trade.status === 'completed' && (
                <div className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-6 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                  <p className="font-serif text-lg text-white">Order Completed</p>

                  {isSeller && (
                    <button
                      onClick={markListingInStock}
                      disabled={updating}
                      className="w-full rounded-xl bg-amber-500 py-3 text-[9px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-400 disabled:opacity-50"
                    >
                      Mark Product In Stock
                    </button>
                  )}

                  {!showRating && (
                    <button
                      onClick={() => setShowRating(true)}
                      className="w-full rounded-xl border border-white/5 bg-white/10 py-3 text-[9px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/20"
                    >
                      Rate this transaction
                    </button>
                  )}
                </div>
              )}

              {trade.status === 'cancelled' && (
                <div className="space-y-4 rounded-2xl border border-slate-500/20 bg-white/5 p-6 text-center">
                  <AlertCircle className="mx-auto h-10 w-10 text-slate-500" />
                  <p className="font-serif text-lg text-white">Trade Cancelled</p>
                  <p className="text-[9px] uppercase leading-relaxed tracking-widest text-slate-500">
                    This bargain was closed before escrow payment.
                  </p>
                </div>
              )}

              {trade.status !== 'completed' && trade.status !== 'cancelled' && trade.status !== 'disputed' && (
                <button
                  onClick={handleOpenDispute}
                  disabled={updating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-red-500 transition-all hover:bg-red-500/20 disabled:opacity-50"
                >
                  <AlertCircle className="h-4 w-4" />
                  Need Help? Open a Dispute
                </button>
              )}

              {trade.status === 'disputed' && (
                <div className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
                  <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
                  <p className="font-serif text-lg text-white">Dispute Open</p>
                  <p className="text-[9px] uppercase leading-relaxed tracking-widest text-slate-500">
                    Our support team has been notified and will help resolve this.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showDeliveryRequestPanel && trade && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-4 backdrop-blur-md">
            <div className="mx-auto my-8 max-w-5xl">
              <DeliveryRequestPanel
                tradeId={trade.id}
                buyerId={trade.buyerId}
                sellerId={trade.sellerId}
                packageValue={trade.amount}
                currency={trade.currency}
                currencyCode={getTradeCurrency(trade)}
                currencyLocale={getTradeLocale(trade)}
                currencyLabel={trade.currencyLabel}
                defaultPackageType={listing?.category}
                defaultPickupAddress={
                  trade.deliveryPickupAddress ||
                  listing?.locationName ||
                  listing?.location ||
                  'Seller pickup location'
                }
                defaultPickupLocation={
                  toGeoPoint(trade.deliveryPickupLocation) ||
                  toGeoPoint(listing)
                }
                defaultDropoffAddress={buildDropoffAddress(profileData)}
                defaultDropoffLocation={toGeoPoint(profileData)}
                onCreated={() => setShowDeliveryRequestPanel(false)}
              />

              <button
                onClick={() => setShowDeliveryRequestPanel(false)}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-white hover:text-black"
              >
                Close
              </button>
            </div>
          </div>
        )}

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
                  Driver accepts first, then you bargain delivery fee.
                </p>
              </div>

              <div className="scrollbar-hide max-h-[40vh] space-y-4 overflow-y-auto pr-2">
                {(availableDrivers.length > 0 ? availableDrivers : drivers).length > 0 ? (
                  (availableDrivers.length > 0 ? availableDrivers : drivers).map(driver => (
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
