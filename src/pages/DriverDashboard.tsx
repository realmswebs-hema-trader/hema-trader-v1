import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Navigation,
  PackageCheck,
  Power,
  Radio,
  ShieldCheck,
  Truck,
  Wallet,
  WifiOff,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import PendingDeliveryRequests from '../components/delivery/PendingDeliveryRequests';
import DeliveryTimeline from '../components/delivery/DeliveryTimeline';
import {
  updateDeliveryRequestStatus,
  type DeliveryStatus
} from '../services/deliveryService';
import {
  startTracking,
  stopTracking
} from '../services/locationTrackingService';

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

const completedStatuses = ['completed', 'cancelled', 'disputed'];

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
  return 'Update Status';
};

export default function DriverDashboard() {
  const { user, profile } = useAuth();

  const [deliveries, setDeliveries] = useState<DeliveryRequest[]>([]);
  const [nearbyRequests, setNearbyRequests] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState('');
  const [gpsWatcherKey, setGpsWatcherKey] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);

  const driverStatus = profile?.driverStatus || 'offline';
  const isGpsActive = Boolean(gpsWatcherKey || profile?.gpsTrackingActive);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const unsubscribeDeliveries = onSnapshot(
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
        console.error('Driver dashboard deliveries sync failed:', error);
        setLoading(false);
      }
    );

    const unsubscribeNearby = onSnapshot(
      query(
        collection(db, 'deliveryRequests'),
        where('status', '==', 'pending'),
        limit(50)
      ),
      snapshot => {
        setNearbyRequests(
          snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as DeliveryRequest[]
        );
      },
      error => console.error('Nearby delivery requests sync failed:', error)
    );

    return () => {
      unsubscribeDeliveries();
      unsubscribeNearby();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;

    const shouldTrack =
      driverStatus === 'available' ||
      driverStatus === 'on_trip' ||
      driverStatus === 'online';

    if (!shouldTrack || gpsWatcherKey) return;

    try {
      const activeDelivery = deliveries.find(delivery =>
        activeStatuses.includes(String(delivery.deliveryStatus || delivery.status))
      );

      const watcherKey = startTracking({
        driverId: user.uid,
        deliveryId: activeDelivery?.id,
        driverStatus: activeDelivery ? 'on_trip' : 'available',
        onError: error => setGpsError(error.message)
      });

      setGpsWatcherKey(watcherKey);
      setGpsError('');
    } catch (error) {
      console.error('GPS start failed:', error);
      setGpsError('GPS unavailable. Allow location permission to go live.');
    }
  }, [user?.uid, driverStatus, deliveries, gpsWatcherKey]);

  const stats = useMemo(() => {
    const active = deliveries.filter(item =>
      activeStatuses.includes(String(item.deliveryStatus || item.status))
    );

    const completed = deliveries.filter(item =>
      completedStatuses.includes(String(item.deliveryStatus || item.status))
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

  const updateDriverStatus = async (
    status: 'available' | 'on_trip' | 'offline'
  ) => {
    if (!user?.uid) return;

    setStatusUpdating(true);

    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          driverStatus: status,
          availability: status,
          isOnline: status !== 'offline',
          online: status !== 'offline',
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      if (status === 'offline') {
        await stopTracking(gpsWatcherKey || undefined, user.uid);
        setGpsWatcherKey(null);
      } else if (!gpsWatcherKey) {
        const watcherKey = startTracking({
          driverId: user.uid,
          driverStatus: status === 'on_trip' ? 'on_trip' : 'available',
          onError: error => setGpsError(error.message)
        });

        setGpsWatcherKey(watcherKey);
        setGpsError('');
      }
    } catch (error) {
      console.error('Driver status update failed:', error);
      setGpsError('Could not update driver availability.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const advanceDelivery = async (delivery: DeliveryRequest) => {
    if (!delivery.tradeId || !user?.uid) return;

    const current = String(delivery.deliveryStatus || delivery.status || 'assigned');
    const next = nextStatus(current);

    if (!next || next === 'buyer_confirmation') return;

    setUpdatingId(delivery.id);

    try {
      await updateDeliveryRequestStatus(
        delivery.id,
        delivery.tradeId,
        next,
        user.uid
      );
    } finally {
      setUpdatingId('');
    }
  };

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
        <Truck className="mx-auto mb-5 h-14 w-14 text-slate-700" />
        <h1 className="font-serif text-3xl text-white">Driver access required</h1>
        <p className="mt-3 text-sm text-slate-500">
          Please sign in to view your logistics dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="relative bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/30 p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_35%)]" />

          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Truck className="h-8 w-8 text-amber-500" />
                <h1 className="font-serif text-4xl text-white">
                  Driver Command Center
                </h1>
              </div>

              <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Live routes, driver earnings, GPS heartbeat, and delivery operations
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${
                    driverStatus === 'offline'
                      ? 'border-slate-700 bg-white/5 text-slate-500'
                      : 'border-green-500/20 bg-green-500/10 text-green-400'
                  }`}
                >
                  {driverStatus.replace('_', ' ')}
                </span>

                <span
                  className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${
                    isGpsActive
                      ? 'border-green-500/20 bg-green-500/10 text-green-400'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {isGpsActive ? 'GPS Active' : 'GPS Waiting'}
                </span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: 'Available', value: 'available', icon: Radio },
                { label: 'On Delivery', value: 'on_trip', icon: Navigation },
                { label: 'Offline', value: 'offline', icon: Power }
              ].map(item => (
                <button
                  key={item.value}
                  onClick={() =>
                    updateDriverStatus(item.value as 'available' | 'on_trip' | 'offline')
                  }
                  disabled={statusUpdating}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[9px] font-black uppercase tracking-widest transition disabled:opacity-50 ${
                    driverStatus === item.value
                      ? 'border-amber-500 bg-amber-500 text-black'
                      : 'border-white/10 bg-black/30 text-slate-400 hover:border-amber-500/30 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 md:grid-cols-5">
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
              label: 'Earnings',
              value: `${stats.earnings.toLocaleString()} CFA`,
              icon: Wallet
            },
            {
              label: 'Trust',
              value: `${profile?.trustScore || profile?.reliabilityScore || 100}%`,
              icon: ShieldCheck
            },
            {
              label: 'Nearby Requests',
              value: nearbyRequests.length,
              icon: Activity
            }
          ].map(item => (
            <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-4">
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

      {gpsError && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          <WifiOff className="h-5 w-5 shrink-0" />
          {gpsError}
        </div>
      )}

      <PendingDeliveryRequests />

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          to="/driver/deliveries"
          className="rounded-[2rem] border border-green-500/20 bg-green-500/10 p-6 transition hover:bg-green-500 hover:text-black"
        >
          <Navigation className="mb-4 h-7 w-7" />
          <h2 className="font-serif text-2xl">Driver Operations</h2>
          <p className="mt-2 text-sm opacity-80">
            Open the full delivery operations page with active routes, earnings,
            and delivery history.
          </p>
        </Link>

        <Link
          to="/drivers"
          className="rounded-[2rem] border border-white/10 bg-white/5 p-6 transition hover:bg-white hover:text-black"
        >
          <Truck className="mb-4 h-7 w-7" />
          <h2 className="font-serif text-2xl">Driver Network</h2>
          <p className="mt-2 text-sm opacity-80">
            See how your live GPS profile appears to buyers searching for drivers.
          </p>
        </Link>
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-amber-500" />
          <h2 className="font-serif text-3xl text-white">
            Active Delivery Routes
          </h2>
        </div>

        {stats.active.length > 0 ? (
          stats.active.map(delivery => {
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
                    </div>

                    <h3 className="font-serif text-2xl text-white">
                      Delivery #{delivery.id.slice(-6).toUpperCase()}
                    </h3>

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

                  <div className="text-right">
                    <p className="font-serif text-xl text-white">
                      {(delivery.driverCommission || 0).toLocaleString()} CFA
                    </p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                      Commission
                    </p>
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
          <div className="rounded-[2.5rem] border border-white/5 bg-brand-card p-14 text-center shadow-2xl">
            <Truck className="mx-auto mb-5 h-14 w-14 text-slate-700" />
            <h3 className="font-serif text-2xl text-white">
              No active delivery routes
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Assigned deliveries will appear here in real time.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
