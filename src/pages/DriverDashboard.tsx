import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  CheckCircle,
  ChevronRight,
  Clock,
  Loader2,
  Navigation,
  Package,
  Truck,
  Zap
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import PendingDeliveryRequests from '../components/delivery/PendingDeliveryRequests';
import { updateReliability } from '../services/matchingService';

interface DeliveryTrade {
  id: string;
  status?: string;
  amount: number;
  deliveryStatus?: string;
  deliveryFee?: number;
  driverCommission?: number;
  buyerId: string;
  sellerId: string;
  createdAt?: any;
  updatedAt?: any;
}

interface DriverProfile {
  totalEarnings?: number;
  reliabilityScore?: number;
  deliveriesCount?: number;
  warningCount?: number;
}

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const sortByUpdatedAt = (items: DeliveryTrade[]) =>
  [...items].sort((a, b) => getMillis(b.updatedAt) - getMillis(a.updatedAt));

export default function DriverDashboard() {
  const { user, profile } = useAuth();
  const driverProfile = profile as DriverProfile | null;

  const [deliveries, setDeliveries] = useState<DeliveryTrade[]>([]);
  const [poolRequests, setPoolRequests] = useState<DeliveryTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'completed' | 'pool'>('pool');

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const tradesRef = collection(db, 'trades');

    const qDeliveries = query(
      tradesRef,
      where('driverId', '==', user.uid)
    );

    const unsubscribeDeliveries = onSnapshot(
      qDeliveries,
      snapshot => {
        const nextDeliveries = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        })) as DeliveryTrade[];

        setDeliveries(sortByUpdatedAt(nextDeliveries));
        setLoading(false);
      },
      error => {
        handleFirestoreError(error, OperationType.SUBSCRIBE, 'driver deliveries');
        setLoading(false);
      }
    );

    const qPool = query(
      tradesRef,
      where('deliveryRequestStatus', '==', 'open')
    );

    const unsubscribePool = onSnapshot(
      qPool,
      snapshot => {
        const nextPoolRequests = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        })) as DeliveryTrade[];

        setPoolRequests(sortByUpdatedAt(nextPoolRequests));
      },
      error => {
        handleFirestoreError(error, OperationType.SUBSCRIBE, 'delivery pool');
      }
    );

    return () => {
      unsubscribeDeliveries();
      unsubscribePool();
    };
  }, [user]);

  const claimRequest = async (tradeId: string) => {
    if (!user || updatingId) return;

    setUpdatingId(tradeId);

    try {
      await runTransaction(db, async transaction => {
        const tradeRef = doc(db, 'trades', tradeId);
        const tradeSnap = await transaction.get(tradeRef);

        if (!tradeSnap.exists()) {
          throw new Error('Trade not found.');
        }

        const tradeData = tradeSnap.data();

        if (tradeData.deliveryRequestStatus !== 'open') {
          throw new Error('Request already claimed by another driver.');
        }

        transaction.update(tradeRef, {
          driverId: user.uid,
          deliveryRequestStatus: 'claimed',
          deliveryStatus: 'accepted',
          updatedAt: serverTimestamp()
        });
      });

      alert('Delivery claimed successfully.');
    } catch (error) {
      const message = handleFirestoreError(
        error,
        OperationType.TRANSACTION,
        `trades/${tradeId}`
      );
      alert(message);
    } finally {
      setUpdatingId(null);
    }
  };

  const updateDeliveryStatus = async (tradeId: string, newStatus: string) => {
    if (!user || updatingId) return;

    setUpdatingId(tradeId);

    try {
      await updateDoc(doc(db, 'trades', tradeId), {
        deliveryStatus: newStatus,
        updatedAt: serverTimestamp()
      });

      if (newStatus === 'delivered') {
        const trade = deliveries.find(delivery => delivery.id === tradeId);

        if (trade) {
          await updateDoc(doc(db, 'users', user.uid), {
            deliveriesCount: increment(1),
            totalEarnings: increment(trade.driverCommission || 0)
          });

          await updateReliability(user.uid, true);
        }
      }

      if (newStatus === 'rejected') {
        await updateReliability(user.uid, false);
      }
    } catch (error) {
      const message = handleFirestoreError(
        error,
        OperationType.UPDATE,
        `trades/${tradeId}`
      );
      alert(message);
    } finally {
      setUpdatingId(null);
    }
  };

  const currentList =
    filter === 'pool'
      ? poolRequests
      : deliveries.filter(delivery =>
          filter === 'active'
            ? delivery.deliveryStatus !== 'delivered' &&
              delivery.deliveryStatus !== 'rejected'
            : delivery.deliveryStatus === 'delivered'
        );

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-900">
          <Truck className="h-8 w-8 text-slate-700" />
        </div>
        <h1 className="mt-6 font-serif text-3xl text-white">
          Driver access required
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          Please sign in to view your fleet dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 pb-24 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-4xl tracking-tight text-white">
            Fleet Dashboard
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">
            Managing {deliveries.length} total deliveries
          </p>
        </div>

        <div className="scrollbar-hide flex gap-2 overflow-x-auto rounded-2xl border border-white/5 bg-black/40 p-1">
          <button
            onClick={() => setFilter('pool')}
            className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'pool'
                ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Zap className="h-3 w-3" />
            Broadcast Pool
          </button>

          <button
            onClick={() => setFilter('active')}
            className={`whitespace-nowrap rounded-xl px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'active'
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            My Orders
          </button>

          <button
            onClick={() => setFilter('completed')}
            className={`whitespace-nowrap rounded-xl px-6 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              filter === 'completed'
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Earnings
          </button>
        </div>
      </div>

      <PendingDeliveryRequests />

      {filter === 'completed' && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-2 rounded-[2rem] border border-white/5 bg-brand-card p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Total Earnings
            </p>
            <p className="font-serif text-2xl text-white">
              {(driverProfile?.totalEarnings || 0).toLocaleString()} CFA
            </p>
          </div>

          <div className="space-y-2 rounded-[2rem] border border-white/5 bg-brand-card p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Reliability
            </p>
            <p className="font-serif text-2xl text-green-500">
              {driverProfile?.reliabilityScore || 100}%
            </p>
          </div>

          <div className="space-y-2 rounded-[2rem] border border-white/5 bg-brand-card p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Deliveries
            </p>
            <p className="font-serif text-2xl text-white">
              {driverProfile?.deliveriesCount || 0}
            </p>
          </div>

          <div className="space-y-2 rounded-[2rem] border border-white/5 bg-brand-card p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Warnings
            </p>
            <p className="font-serif text-2xl text-red-500">
              {driverProfile?.warningCount || 0}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <AnimatePresence mode="popLayout">
          {currentList.length > 0 ? (
            currentList.map(delivery => {
              const isUpdating = updatingId === delivery.id;

              return (
                <motion.div
                  key={delivery.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card p-1 shadow-2xl transition-all hover:border-amber-500/30"
                >
                  <div className="flex flex-col gap-8 p-8 md:flex-row md:items-center">
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
                      <Package className="h-6 w-6 text-amber-500" />
                    </div>

                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-amber-500">
                          {filter === 'pool'
                            ? 'Open Request'
                            : delivery.deliveryStatus?.replace('_', ' ') || 'Assigned'}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                          REF: {delivery.id.slice(-6).toUpperCase()}
                        </span>
                      </div>

                      <h3 className="font-serif text-xl text-white">
                        Value: {(delivery.amount || 0).toLocaleString()} CFA
                      </h3>

                      <div className="flex flex-wrap items-center gap-6 text-slate-400">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-slate-600" />
                          <span className="text-[9px] font-bold uppercase tracking-wider">
                            Earnings:{' '}
                            <span className="text-white">
                              {(delivery.driverCommission || 0).toLocaleString()} CFA
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      {filter === 'pool' && (
                        <button
                          onClick={() => claimRequest(delivery.id)}
                          disabled={isUpdating}
                          className="rounded-xl bg-amber-500 px-8 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400 disabled:opacity-50"
                        >
                          {isUpdating ? 'Claiming...' : 'Claim Trip'}
                        </button>
                      )}

                      {filter === 'active' && delivery.deliveryStatus === 'assigned' && (
                        <>
                          <button
                            onClick={() => updateDeliveryStatus(delivery.id, 'accepted')}
                            disabled={isUpdating}
                            className="rounded-2xl bg-green-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => updateDeliveryStatus(delivery.id, 'rejected')}
                            disabled={isUpdating}
                            className="rounded-2xl border border-red-500/20 bg-red-500/10 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {delivery.deliveryStatus === 'accepted' && (
                        <button
                          onClick={() => updateDeliveryStatus(delivery.id, 'picked_up')}
                          disabled={isUpdating}
                          className="flex items-center gap-2 rounded-2xl bg-amber-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
                        >
                          <Navigation className="h-4 w-4" />
                          Go to Pickup
                        </button>
                      )}

                      {delivery.deliveryStatus === 'picked_up' && (
                        <button
                          onClick={() => updateDeliveryStatus(delivery.id, 'delivered')}
                          disabled={isUpdating}
                          className="flex items-center gap-2 rounded-2xl bg-green-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Proof of Delivery
                        </button>
                      )}

                      <Link
                        to={`/trade/${delivery.id}`}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-500 transition-all hover:bg-white hover:text-black"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Link>
                    </div>
                  </div>
                </motion.div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center space-y-6 py-20 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900">
                <Truck className="h-8 w-8 text-slate-700" />
              </div>
              <div>
                <h3 className="font-serif text-2xl text-slate-400">
                  No active {filter} deliveries
                </h3>
                <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
                  New requests will appear here in real time
                </p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
