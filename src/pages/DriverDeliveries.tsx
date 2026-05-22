import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  Clock,
  Loader2,
  MapPin,
  Navigation,
  PackageCheck,
  ShieldCheck,
  Truck,
  Wallet,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import DeliveryTimeline from '../components/delivery/DeliveryTimeline';
import {
  updateDeliveryRequestStatus,
  type DeliveryStatus
} from '../services/deliveryService';

interface DeliveryRequest {
  id: string;
  tradeId?: string;
  buyerId?: string;
  sellerId?: string;
  driverId?: string;
  status?: DeliveryStatus | string;
  deliveryStatus?: DeliveryStatus | string;
  pickupAddress?: string;
  destinationAddress?: string;
  deliveryFee?: number;
  driverCommission?: number;
  packageType?: string;
  packageWeight?: number;
  estimatedEtaLabel?: string;
  riskLevel?: string;
  createdAt?: any;
}

const activeStatuses = [
  'assigned',
  'driver_arriving',
  'picked_up',
  'in_transit',
  'near_destination',
  'delivered',
  'buyer_confirmation'
];

const nextStatus = (status?: string): DeliveryStatus | null => {
  if (status === 'assigned') return 'driver_arriving';
  if (status === 'driver_arriving') return 'picked_up';
  if (status === 'picked_up') return 'in_transit';
  if (status === 'in_transit') return 'near_destination';
  if (status === 'near_destination') return 'delivered';
  if (status === 'delivered') return 'buyer_confirmation';
  return null;
};

const nextLabel = (status?: string) => {
  if (status === 'assigned') return 'Start Route';
  if (status === 'driver_arriving') return 'Confirm Pickup';
  if (status === 'picked_up') return 'Start Transit';
  if (status === 'in_transit') return 'Near Destination';
  if (status === 'near_destination') return 'Mark Delivered';
  if (status === 'delivered') return 'Await Buyer';
  return 'Update';
};

export default function DriverDeliveries() {
  const { user, profile } = useAuth();

  const [deliveries, setDeliveries] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'deliveryRequests'),
        where('driverId', '==', user.uid),
        limit(100)
      ),
      snapshot => {
        setDeliveries(
          snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as DeliveryRequest[]
        );
        setLoading(false);
      },
      error => {
        console.error('Driver deliveries sync failed:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const stats = useMemo(() => {
    const active = deliveries.filter(item =>
      activeStatuses.includes(String(item.deliveryStatus || item.status))
    );

    const completed = deliveries.filter(
      item => item.deliveryStatus === 'completed' || item.status === 'completed'
    );

    const earnings = deliveries.reduce(
      (sum, item) =>
        item.deliveryStatus === 'completed' || item.status === 'completed'
          ? sum + Number(item.driverCommission || 0)
          : sum,
      0
    );

    return { active, completed, earnings };
  }, [deliveries]);

  const advanceDelivery = async (delivery: DeliveryRequest) => {
    if (!delivery.tradeId) return;

    const current = String(delivery.deliveryStatus || delivery.status || 'assigned');
    const next = nextStatus(current);

    if (!next || next === 'buyer_confirmation') return;

    setUpdatingId(delivery.id);

    try {
      await updateDeliveryRequestStatus(
        delivery.id,
        delivery.tradeId,
        next,
        user?.uid
      );
    } finally {
      setUpdatingId('');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-40">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Truck className="h-7 w-7 text-amber-500" />
              <h1 className="font-serif text-4xl text-white">
                Driver Operations
              </h1>
            </div>
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              Active routes, delivery history, payouts, and live tracking
            </p>
          </div>

          <Link
            to="/driver"
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white hover:text-black"
          >
            Dashboard
          </Link>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {[
            {
              label: 'Active Jobs',
              value: stats.active.length,
              icon: Zap
            },
            {
              label: 'Completed',
              value: stats.completed.length,
              icon: PackageCheck
            },
            {
              label: 'Total Earnings',
              value: `${stats.earnings.toLocaleString()} CFA`,
              icon: Wallet
            },
            {
              label: 'Trust Score',
              value: `${profile?.trustScore || profile?.reliabilityScore || 100}%`,
              icon: ShieldCheck
            }
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-5">
              <item.icon className="mb-3 h-5 w-5 text-amber-500" />
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                {item.label}
              </p>
              <p className="mt-1 font-serif text-xl text-white">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        {deliveries.length > 0 ? (
          deliveries.map(delivery => {
            const status = String(delivery.deliveryStatus || delivery.status || 'assigned');
            const action = nextStatus(status);
            const updating = updatingId === delivery.id;

            return (
              <motion.article
                key={delivery.id}
                whileHover={{ y: -2 }}
                className="space-y-5 rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl"
              >
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-400">
                        {status.replaceAll('_', ' ')}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                        {delivery.packageType || 'package'}
                      </span>
                      {delivery.riskLevel && (
                        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-red-400">
                          Risk {delivery.riskLevel}
                        </span>
                      )}
                    </div>

                    <h2 className="font-serif text-2xl text-white">
                      Delivery #{delivery.id.slice(-6).toUpperCase()}
                    </h2>

                    <div className="grid gap-2 text-sm text-slate-400 md:grid-cols-2">
                      <p>
                        <MapPin className="mr-2 inline h-4 w-4 text-green-400" />
                        {delivery.pickupAddress || 'Pickup location'}
                      </p>
                      <p>
                        <Navigation className="mr-2 inline h-4 w-4 text-amber-500" />
                        {delivery.destinationAddress || 'Destination'}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 text-right md:min-w-44">
                    <p className="font-serif text-xl text-white">
                      {(delivery.driverCommission || 0).toLocaleString()} CFA
                    </p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      Driver commission
                    </p>

                    {delivery.estimatedEtaLabel && (
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                        <Clock className="mr-1 inline h-3 w-3" />
                        {delivery.estimatedEtaLabel}
                      </p>
                    )}
                  </div>
                </div>

                <DeliveryTimeline status={status} compact />

                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/delivery/${delivery.id}`}
                    className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-green-400 hover:bg-green-500 hover:text-black"
                  >
                    <Navigation className="h-4 w-4" />
                    Live Tracking
                  </Link>

                  {action && action !== 'buyer_confirmation' && (
                    <button
                      onClick={() => advanceDelivery(delivery)}
                      disabled={updating}
                      className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
                    >
                      {updating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Truck className="h-4 w-4" />
                      )}
                      {nextLabel(status)}
                    </button>
                  )}
                </div>
              </motion.article>
            );
          })
        ) : (
          <div className="rounded-[2.5rem] border border-white/5 bg-brand-card p-16 text-center shadow-2xl">
            <Truck className="mx-auto mb-5 h-14 w-14 text-slate-700" />
            <h2 className="font-serif text-2xl text-white">
              No delivery jobs yet
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Accepted and assigned deliveries will appear here in real time.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
