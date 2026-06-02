import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  ShieldCheck,
  Truck,
  WalletCards,
  X
} from 'lucide-react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';

import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { db } from '../lib/firebase';
import {
  applyTemporaryModeratorDefaultsForSignedInUser,
  respondToModeratorDeliveryRequest,
  setModeratorAvailability,
  TEMPORARY_DEFAULT_MODERATOR_EMAIL,
  updateModeratorDeliveryStatus
} from '../services/moderatorDeliveryService';
import {
  moderatorDeliveryStatusLabels,
  type ModeratorAvailability,
  type ModeratorDeliveryRequest
} from '../types/moderatorDelivery';

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: ['XAF', 'XOF', 'UGX', 'RWF'].includes(currencyCode)
        ? 0
        : 2
    }).format(amount || 0);
  } catch {
    return `${currencyCode} ${(amount || 0).toLocaleString()}`;
  }
};

const statusClass = (status: string) => {
  if (status.includes('delivered') || status === 'completed') {
    return 'border-green-500/20 bg-green-500/10 text-green-400';
  }

  if (status.includes('declined') || status === 'cancelled') {
    return 'border-red-500/20 bg-red-500/10 text-red-400';
  }

  return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
};

export default function ModeratorDashboard() {
  const { user, profile } = useAuth();
  const { sendManyNotifications } = useNotifications();

  const [requests, setRequests] = useState<ModeratorDeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [message, setMessage] = useState('');

  const isTemporaryModeratorEmail =
    user?.email?.toLowerCase() === TEMPORARY_DEFAULT_MODERATOR_EMAIL;

  const isModerator =
    Boolean(profile?.isModerator) ||
    Boolean(profile?.moderatorVerified) ||
    Boolean(profile?.roles?.includes('moderator'));

  const availability =
    (profile?.moderatorAvailability as ModeratorAvailability) || 'offline';

  const pendingRequests = useMemo(
    () =>
      requests.filter(
        request =>
          request.status === 'moderator_requested' ||
          request.status === 'moderator_assigned'
      ),
    [requests]
  );

  const activeRequests = useMemo(
    () =>
      requests.filter(request =>
        [
          'moderator_accepted',
          'picked_up_by_moderator',
          'in_transit_by_moderator'
        ].includes(request.status)
      ),
    [requests]
  );

  const completedRequests = useMemo(
    () =>
      requests.filter(request =>
        ['delivered_by_moderator', 'completed'].includes(request.status)
      ),
    [requests]
  );

  useEffect(() => {
    if (!user || !isModerator) {
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const requestsQuery = query(
      collection(db, 'moderatorDeliveries'),
      where('moderatorId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(75)
    );

    const unsubscribe = onSnapshot(
      requestsQuery,
      snapshot => {
        setRequests(
          snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as ModeratorDeliveryRequest[]
        );
        setLoading(false);
      },
      error => {
        console.error('Moderator requests listener failed:', error);
        setMessage('Could not load moderator delivery requests.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, isModerator]);

  const runAction = async (requestId: string, action: () => Promise<void>) => {
    setWorkingId(requestId);
    setMessage('');

    try {
      await action();
    } catch (error) {
      console.error('Moderator action failed:', error);
      setMessage(
        error instanceof Error ? error.message : 'Moderator action failed.'
      );
    } finally {
      setWorkingId('');
    }
  };

  const activateTemporaryModerator = async () => {
    if (!user) return;

    setWorkingId('temporary_setup');
    setMessage('');

    try {
      await applyTemporaryModeratorDefaultsForSignedInUser(user);
      setMessage('Temporary moderator access activated. Refresh if the dashboard does not appear.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not activate temporary moderator access.'
      );
    } finally {
      setWorkingId('');
    }
  };

  const updateAvailability = async (nextAvailability: ModeratorAvailability) => {
    if (!user) return;

    setWorkingId('availability');

    try {
      await setModeratorAvailability(user, nextAvailability);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not update availability.'
      );
    } finally {
      setWorkingId('');
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center">
        <ShieldCheck className="mx-auto mb-5 h-10 w-10 text-amber-500" />
        <h1 className="font-serif text-3xl text-white">Moderator Dashboard</h1>
        <p className="mt-3 text-sm text-slate-500">Sign in to continue.</p>
      </div>
    );
  }

  if (!isModerator) {
    return (
      <div className="mx-auto max-w-xl space-y-5 rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="font-serif text-3xl text-white">
          Moderator Access Required
        </h1>
        <p className="text-sm leading-relaxed text-slate-500">
          Only approved Hema Moderators can access long-distance delivery
          requests. Users can apply, but only admin can approve moderators.
        </p>

        {isTemporaryModeratorEmail && (
          <button
            onClick={activateTemporaryModerator}
            disabled={workingId === 'temporary_setup'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
          >
            {workingId === 'temporary_setup' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Activate Temporary Moderator
          </button>
        )}

        {message && (
          <p className="rounded-xl border border-white/5 bg-black/30 p-4 text-sm text-amber-200">
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500">
              Verified Hema Moderator
            </p>
            <h1 className="mt-2 font-serif text-4xl text-white">
              Moderator Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Coordinate long-distance pickup, delivery, and verified delivery
              confirmation while escrow protects the trade.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['available', 'busy', 'offline'] as ModeratorAvailability[]).map(
              item => (
                <button
                  key={item}
                  onClick={() => updateAvailability(item)}
                  disabled={workingId === 'availability'}
                  className={`rounded-full border px-4 py-2 text-[9px] font-black uppercase tracking-widest ${
                    availability === item
                      ? 'border-amber-500 bg-amber-500 text-black'
                      : 'border-white/10 bg-white/5 text-slate-400'
                  }`}
                >
                  {item}
                </button>
              )
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            { label: 'Pending', value: pendingRequests.length, icon: Clock },
            { label: 'Active', value: activeRequests.length, icon: Truck },
            { label: 'Delivered', value: completedRequests.length, icon: CheckCircle2 },
            {
              label: 'Wallet',
              value: formatMoney(Number(profile?.moderatorWalletBalance || 0)),
              icon: WalletCards
            }
          ].map(item => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/5 bg-black/30 p-4"
            >
              <item.icon className="mb-3 h-5 w-5 text-amber-500" />
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                {item.label}
              </p>
              <p className="mt-2 font-serif text-2xl text-white">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {message && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {message}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center rounded-[2rem] border border-white/5 bg-brand-card p-16">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-[2rem] border border-white/5 bg-brand-card p-12 text-center">
          <Truck className="mx-auto mb-5 h-10 w-10 text-slate-700" />
          <h2 className="font-serif text-2xl text-white">
            No moderator deliveries yet
          </h2>
        </div>
      ) : (
        <section className="space-y-4">
          {requests.map(request => (
            <article
              key={request.id}
              className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-xl"
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${statusClass(request.status)}`}
                    >
                      {moderatorDeliveryStatusLabels[request.status] ||
                        request.status}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {getMillis(request.createdAt)
                        ? new Date(getMillis(request.createdAt)).toLocaleString()
                        : 'Recently'}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-serif text-2xl text-white">
                      Trade #{request.tradeId.slice(-6).toUpperCase()}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      Moderator fee:{' '}
                      <span className="font-bold text-white">
                        {formatMoney(
                          request.moderatorFee,
                          request.currencyCode,
                          request.currencyLocale
                        )}
                      </span>{' '}
                      | Net earning:{' '}
                      <span className="font-bold text-green-400">
                        {formatMoney(
                          request.moderatorNetEarning,
                          request.currencyCode,
                          request.currencyLocale
                        )}
                      </span>
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                        Pickup
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm text-white">
                        <MapPin className="h-4 w-4 text-amber-500" />
                        {request.pickupAddress}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
                      <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                        Drop-off
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm text-white">
                        <Truck className="h-4 w-4 text-green-500" />
                        {request.dropoffAddress}
                      </p>
                    </div>
                  </div>

                  {request.status !== 'moderator_requested' && (
                    <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 text-xs leading-relaxed text-green-100/80">
                      Moderator can access buyer and seller contact details only
                      for delivery coordination. Buyer and seller contact bypass
                      remains blocked.
                    </div>
                  )}
                </div>

                <div className="flex min-w-56 flex-col gap-2">
                  <Link
                    to={`/trade/${request.tradeId}`}
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-center text-[10px] font-black uppercase tracking-widest text-white hover:bg-white hover:text-black"
                  >
                    Open Trade
                  </Link>

                  {request.status === 'moderator_requested' && (
                    <>
                      <button
                        onClick={() =>
                          runAction(request.id, () =>
                            respondToModeratorDeliveryRequest({
                              moderatorId: user.uid,
                              requestId: request.id,
                              accepted: true,
                              sendManyNotifications
                            })
                          )
                        }
                        disabled={workingId === request.id}
                        className="flex items-center justify-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          runAction(request.id, () =>
                            respondToModeratorDeliveryRequest({
                              moderatorId: user.uid,
                              requestId: request.id,
                              accepted: false,
                              sendManyNotifications
                            })
                          )
                        }
                        disabled={workingId === request.id}
                        className="flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-red-400 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        Decline
                      </button>
                    </>
                  )}

                  {request.status === 'moderator_accepted' && (
                    <button
                      onClick={() =>
                        runAction(request.id, () =>
                          updateModeratorDeliveryStatus({
                            moderatorId: user.uid,
                            requestId: request.id,
                            status: 'picked_up_by_moderator',
                            sendManyNotifications
                          })
                        )
                      }
                      disabled={workingId === request.id}
                      className="rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                    >
                      Confirm Pickup
                    </button>
                  )}

                  {request.status === 'picked_up_by_moderator' && (
                    <button
                      onClick={() =>
                        runAction(request.id, () =>
                          updateModeratorDeliveryStatus({
                            moderatorId: user.uid,
                            requestId: request.id,
                            status: 'in_transit_by_moderator',
                            sendManyNotifications
                          })
                        )
                      }
                      disabled={workingId === request.id}
                      className="rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                    >
                      Mark In Transit
                    </button>
                  )}

                  {request.status === 'in_transit_by_moderator' && (
                    <button
                      onClick={() =>
                        runAction(request.id, () =>
                          updateModeratorDeliveryStatus({
                            moderatorId: user.uid,
                            requestId: request.id,
                            status: 'delivered_by_moderator',
                            sendManyNotifications
                          })
                        )
                      }
                      disabled={workingId === request.id}
                      className="rounded-xl bg-green-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                    >
                      Mark Delivered
                    </button>
                  )}

                  {workingId === request.id && (
                    <div className="flex justify-center py-3">
                      <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

