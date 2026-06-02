import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  ShieldCheck,
  Truck,
  UserCheck
} from 'lucide-react';

import { useNotifications } from '../notifications/NotificationContext';
import {
  getApprovedModeratorsForRoute,
  requestModeratorDelivery
} from '../../services/moderatorDeliveryService';
import type { ModeratorProfile } from '../../types/moderatorDelivery';

interface ModeratorDeliveryRequestPanelProps {
  tradeId: string;
  listingId?: string;
  buyerId: string;
  sellerId: string;
  pickupAddress: string;
  dropoffAddress: string;
  buyerPhone?: string;
  sellerPhone?: string;
  currencyCode?: string;
  currencyLocale?: string;
  onCreated?: (requestId: string) => void;
}

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

const buildRouteLabel = (pickupAddress: string, dropoffAddress: string) => {
  const pickupCity = pickupAddress.split(',')[0]?.trim();
  const dropoffCity = dropoffAddress.split(',')[0]?.trim();

  if (pickupCity && dropoffCity) return `${pickupCity}-${dropoffCity}`;

  return '';
};

const displayModeratorName = (moderator: ModeratorProfile) =>
  moderator.displayName || moderator.name || 'Verified Hema Moderator';

export default function ModeratorDeliveryRequestPanel({
  tradeId,
  listingId,
  buyerId,
  sellerId,
  pickupAddress,
  dropoffAddress,
  buyerPhone,
  sellerPhone,
  currencyCode = 'XAF',
  currencyLocale = 'fr-CM',
  onCreated
}: ModeratorDeliveryRequestPanelProps) {
  const { sendNotification, sendManyNotifications } = useNotifications();

  const [moderators, setModerators] = useState<ModeratorProfile[]>([]);
  const [selectedModeratorId, setSelectedModeratorId] = useState('');
  const [moderatorFee, setModeratorFee] = useState('');
  const [loadingModerators, setLoadingModerators] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const routeLabel = useMemo(
    () => buildRouteLabel(pickupAddress, dropoffAddress),
    [pickupAddress, dropoffAddress]
  );

  const selectedModerator = moderators.find(
    moderator => moderator.id === selectedModeratorId
  );

  useEffect(() => {
    let mounted = true;

    setLoadingModerators(true);
    setMessage('');

    getApprovedModeratorsForRoute(routeLabel)
      .then(nextModerators => {
        if (!mounted) return;

        setModerators(nextModerators);
        setSelectedModeratorId(nextModerators[0]?.id || '');
      })
      .catch(error => {
        console.error('Moderator discovery failed:', error);
        if (mounted) {
          setMessage('Could not load moderators for this route.');
        }
      })
      .finally(() => {
        if (mounted) setLoadingModerators(false);
      });

    return () => {
      mounted = false;
    };
  }, [routeLabel]);

  const submitRequest = async () => {
    if (!selectedModerator) {
      setMessage('Select a verified moderator first.');
      return;
    }

    const fee = Number(moderatorFee);

    if (!Number.isFinite(fee) || fee <= 0) {
      setMessage('Enter a valid moderator delivery fee.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const requestId = await requestModeratorDelivery({
        input: {
          tradeId,
          listingId,
          buyerId,
          sellerId,
          moderatorId: selectedModerator.id,
          moderatorName: displayModeratorName(selectedModerator),
          pickupAddress,
          dropoffAddress,
          routeLabel,
          moderatorFee: fee,
          currencyCode,
          currencyLocale,
          buyerPhone,
          sellerPhone
        },
        sendNotification,
        sendManyNotifications
      });

      setMessage('Moderator delivery request sent.');
      onCreated?.(requestId);
    } catch (error) {
      console.error('Moderator delivery request failed:', error);
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not request moderator delivery.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-5 rounded-[2rem] border border-amber-500/20 bg-amber-500/5 p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-amber-500 p-3 text-black">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-serif text-2xl text-white">
            Moderator-Assisted Delivery
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Long-distance trade? A verified Hema Moderator can coordinate
            pickup and delivery while product funds stay protected by escrow.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
            Pickup
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-white">
            <MapPin className="h-4 w-4 text-amber-500" />
            {pickupAddress || 'Seller pickup location'}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
            Drop-off
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-white">
            <Truck className="h-4 w-4 text-green-500" />
            {dropoffAddress || 'Buyer delivery location'}
          </p>
        </div>
      </div>

      {loadingModerators ? (
        <div className="flex items-center justify-center rounded-2xl border border-white/5 bg-black/30 p-8">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
        </div>
      ) : moderators.length === 0 ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-200">
          <AlertCircle className="mb-3 h-5 w-5 text-red-400" />
          No verified moderator is currently listed for this route. Admin can
          manually assign one from the moderator dashboard.
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Select Moderator
          </label>
          <div className="grid gap-3">
            {moderators.map(moderator => {
              const selected = moderator.id === selectedModeratorId;

              return (
                <button
                  key={moderator.id}
                  type="button"
                  onClick={() => setSelectedModeratorId(moderator.id)}
                  className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
                    selected
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-white/5 bg-black/30 hover:border-white/20'
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-900">
                    {moderator.photoURL ? (
                      <img
                        src={moderator.photoURL}
                        alt={displayModeratorName(moderator)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserCheck className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-lg text-white">
                      {displayModeratorName(moderator)}
                    </p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                      {(moderator.moderatorRoutes || []).join(', ') ||
                        'Approved routes'}
                    </p>
                  </div>
                  {selected && <CheckCircle2 className="h-5 w-5 text-amber-500" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Moderator Delivery Fee
        </label>
        <input
          type="number"
          min="1"
          value={moderatorFee}
          onChange={event => setModeratorFee(event.target.value)}
          placeholder={`Example: ${formatMoney(20000, currencyCode, currencyLocale)}`}
          className="w-full rounded-2xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4 text-xs leading-relaxed text-green-100/80">
        Moderator delivery funds are released immediately after payment so the
        moderator can begin transportation. Product escrow remains protected
        until delivery is confirmed.
      </div>

      {message && (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-amber-200">
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={submitRequest}
        disabled={submitting || !selectedModeratorId || moderators.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-amber-400 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="h-4 w-4" />
        )}
        Request Verified Moderator
      </button>
    </section>
  );
}

