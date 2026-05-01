import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, increment, runTransaction } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { Truck, Package, CheckCircle, Clock, MapPin, ChevronRight, Loader2, Navigation, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { updateReliability } from '../services/matchingService';

interface DeliveryTrade {
  id: string;
  status: string;
  amount: number;
  deliveryStatus: string;
  deliveryFee: number;
  driverCommission: number;
  buyerId: string;
  sellerId: string;
  createdAt: any;
}

export default function DriverDashboard() {
  const { user, profile } = useAuth();
  const [deliveries, setDeliveries] = useState<DeliveryTrade[]>([]);
  const [poolRequests, setPoolRequests] = useState<DeliveryTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'completed' | 'pool'>('pool');

  useEffect(() => {
    if (!user) return;

    // Assigned/Active Deliveries
    const tradesRef = collection(db, 'trades');
    const qDeliveries = query(
      tradesRef,
      where('driverId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubDeliveries = onSnapshot(qDeliveries, (snapshot) => {
      setDeliveries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DeliveryTrade)));
      setLoading(false);
    }, (err) => console.error('Driver Sync Error:', err));

    // Open Pool Requests (Multi-driver broadcast)
    const qPool = query(
      tradesRef,
      where('deliveryRequestStatus', '==', 'open'),
      orderBy('updatedAt', 'desc')
    );

    const unsubPool = onSnapshot(qPool, (snapshot) => {
      setPoolRequests(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DeliveryTrade)));
    }, (err) => console.error('Pool Sync Error:', err));

    return () => {
      unsubDeliveries();
      unsubPool();
    };
  }, [user]);

  const claimRequest = async (tradeId: string) => {
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        const tradeRef = doc(db, 'trades', tradeId);
        const tradeSnap = await transaction.get(tradeRef);
        
        if (!tradeSnap.exists()) throw "Trade not found";
        
        const tradeData = tradeSnap.data();
        if (tradeData.deliveryRequestStatus !== 'open') {
          throw "Request already claimed by another driver";
        }

        transaction.update(tradeRef, {
          driverId: user.uid,
          deliveryRequestStatus: 'claimed',
          deliveryStatus: 'accepted',
          updatedAt: serverTimestamp()
        });
      });
      alert('Delivery claimed successfully!');
    } catch (err) {
      console.error('Claim error:', err);
      alert(err);
    }
  };

  const updateDeliveryStatus = async (tradeId: string, newStatus: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'trades', tradeId), {
        deliveryStatus: newStatus,
        updatedAt: serverTimestamp()
      });

      if (newStatus === 'delivered') {
        const trade = deliveries.find(d => d.id === tradeId);
        if (trade) {
          // Update profile stats
          const profileRef = doc(db, 'users', user.uid);
          await updateDoc(profileRef, {
            deliveriesCount: increment(1),
            totalEarnings: increment(trade.driverCommission)
          });
          // Update reliability
          await updateReliability(user.uid, true);
        }
      }
      
      if (newStatus === 'rejected') {
        await updateReliability(user.uid, false);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `trades/${tradeId}`);
    }
  };

  const currentList = filter === 'pool' 
    ? poolRequests 
    : deliveries.filter(d => 
        filter === 'active' 
          ? d.deliveryStatus !== 'delivered' && d.deliveryStatus !== 'rejected'
          : d.deliveryStatus === 'delivered'
      );

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 pb-24 pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-4xl text-white tracking-tight">Fleet Dashboard</h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-slate-500">Managing {deliveries.length} total deliveries</p>
        </div>

        <div className="flex gap-2 rounded-2xl bg-black/40 p-1 border border-white/5 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setFilter('pool')}
            className={`flex items-center gap-2 px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              filter === 'pool' ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Zap className="h-3 w-3" /> Broadcast Pool
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              filter === 'active' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            My Orders
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              filter === 'completed' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Earnings
          </button>
        </div>
      </div>

      {filter === 'completed' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Earnings</p>
            <p className="text-2xl font-serif text-white">{profile?.totalEarnings?.toLocaleString() || 0} CFA</p>
          </div>
          <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Reliability</p>
            <p className="text-2xl font-serif text-green-500">{profile?.reliabilityScore || 100}%</p>
          </div>
          <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Deliveries</p>
            <p className="text-2xl font-serif text-white">{profile?.deliveriesCount || 0}</p>
          </div>
          <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Warnings</p>
            <p className="text-2xl font-serif text-red-500">{profile?.warningCount || 0}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <AnimatePresence mode="popLayout">
          {currentList.length > 0 ? currentList.map((delivery) => (
            <motion.div
              key={delivery.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="group relative overflow-hidden rounded-[2.5rem] bg-brand-card p-1 border border-white/5 shadow-2xl transition-all hover:border-amber-500/30"
            >
              <div className="flex flex-col md:flex-row md:items-center p-8 gap-8">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20">
                  <Package className="h-6 w-6 text-amber-500" />
                </div>

                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500 bg-amber-500/5 px-3 py-1 rounded-full border border-amber-500/20">
                      {filter === 'pool' ? 'OPEN REQUEST' : delivery.deliveryStatus?.replace('_', ' ')}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">REF: {delivery.id.slice(-6).toUpperCase()}</span>
                  </div>
                  
                  <h3 className="font-serif text-xl text-white">Value: {delivery.amount.toLocaleString()} CFA</h3>
                  
                  <div className="flex flex-wrap items-center gap-6 text-slate-400">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-slate-600" />
                      <span className="text-[9px] font-bold uppercase tracking-wider">Earnings: <span className="text-white">{delivery.driverCommission?.toLocaleString()} CFA</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  {filter === 'pool' && (
                    <button 
                      onClick={() => claimRequest(delivery.id)}
                      className="rounded-xl bg-amber-500 px-8 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400"
                    >
                      Claim Trip
                    </button>
                  )}
                  
                  {filter === 'active' && delivery.deliveryStatus === 'assigned' && (
                    <>
                      <button 
                        onClick={() => updateDeliveryStatus(delivery.id, 'accepted')}
                        className="rounded-2xl bg-green-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400"
                      >
                        Accept
                      </button>
                      <button 
                        onClick={() => updateDeliveryStatus(delivery.id, 'rejected')}
                        className="rounded-2xl bg-red-500/10 border border-red-500/20 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500/20"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  
                  {delivery.deliveryStatus === 'accepted' && (
                    <button 
                      onClick={() => updateDeliveryStatus(delivery.id, 'picked_up')}
                      className="rounded-2xl bg-amber-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 flex items-center gap-2"
                    >
                      <Navigation className="h-4 w-4" /> Go to Pickup
                    </button>
                  )}

                  {delivery.deliveryStatus === 'picked_up' && (
                    <button 
                      onClick={() => updateDeliveryStatus(delivery.id, 'delivered')}
                      className="rounded-2xl bg-green-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-green-400 flex items-center gap-2"
                    >
                      <CheckCircle className="h-4 w-4" /> Proof of Delivery
                    </button>
                  )}

                  <Link 
                    to={`/trade/${delivery.id}`}
                    className="flex items-center justify-center h-12 w-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white text-slate-500 hover:text-black transition-all"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </div>
              </div>
            </motion.div>
          )) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
              <div className="h-20 w-20 rounded-full bg-slate-900 flex items-center justify-center">
                <Truck className="h-8 w-8 text-slate-700" />
              </div>
              <div>
                <h3 className="font-serif text-2xl text-slate-400">No active {filter} deliveries</h3>
                <p className="text-[10px] uppercase tracking-widest text-slate-600 mt-2">New requests will appear here in real-time</p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
