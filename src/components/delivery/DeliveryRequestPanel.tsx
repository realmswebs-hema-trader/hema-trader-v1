import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Scale,
  ShieldCheck,
  Sparkles,
  Truck
} from 'lucide-react';
import { motion } from 'motion/react';

import {
  calculateDeliveryFee,
  calculateSmartETA,
  getVehicleRecommendation,
  findBestDriversForDelivery,
  type MatchedDriver
} from '../../services/logisticsMatching';
import { createDeliveryRequest } from '../../services/deliveryService';
import {
  requestBrowserLocation,
  toGeoPoint,
  type GeoPoint
} from '../../utils/geoUtils';

interface DeliveryRequestPanelProps {
  tradeId: string;
  buyerId: string;
  sellerId: string;
  packageValue?: number;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  currencyLabel?: string;
  defaultPackageType?: string;
  defaultPickupAddress?: string;
  defaultDropoffAddress?: string;
  defaultPickupLocation?: GeoPoint | null;
  defaultDropoffLocation?: GeoPoint | null;
  onCreated?: (deliveryId: string) => void;
}

const packageTypes = [
  { id: 'produce', label: 'Produce' },
  { id: 'livestock', label: 'Livestock' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'cold_chain', label: 'Cold Chain' },
  { id: 'documents', label: 'Documents' },
  { id: 'general', label: 'General' }
];

const urgencyOptions = [
  { id: 'normal', label: 'Normal' },
  { id: 'same_day', label: 'Same Day' },
  { id: 'urgent', label: 'Urgent' }
];

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: zeroDecimalCurrencies.has(currencyCode) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${currencyCode} ${(amount || 0).toLocaleString()}`;
  }
};

const normalizePackageType = (value?: string) => {
  const lower = (value || '').toLowerCase();

  if (lower.includes('animal') || lower.includes('livestock')) return 'livestock';
  if (lower.includes('seed') || lower.includes('farm') || lower.includes('produce')) return 'produce';
  if (lower.includes('equipment')) return 'equipment';
  if (lower.includes('cold')) return 'cold_chain';

  return 'produce';
};

export default function DeliveryRequestPanel({
  tradeId,
  buyerId,
  sellerId,
  packageValue = 0,
  currency,
  currencyCode,
  currencyLocale = 'fr-CM',
  currencyLabel,
  defaultPackageType,
  defaultPickupAddress = '',
  defaultDropoffAddress = '',
  defaultPickupLocation = null,
  defaultDropoffLocation = null,
  onCreated
}: DeliveryRequestPanelProps) {
  const activeCurrency = currencyCode || currency || 'XAF';

  const [pickupAddress, setPickupAddress] = useState(defaultPickupAddress);
  const [dropoffAddress, setDropoffAddress] = useState(defaultDropoffAddress);
  const [pickupLocation, setPickupLocation] = useState<GeoPoint | null>(
    toGeoPoint(defaultPickupLocation)
  );
  const [dropoffLocation, setDropoffLocation] = useState<GeoPoint | null>(
    toGeoPoint(defaultDropoffLocation)
  );
  const [packageType, setPackageType] = useState(
    normalizePackageType(defaultPackageType)
  );
  const [packageWeight, setPackageWeight] = useState('10');
  const [urgency, setUrgency] = useState('normal');
  const [instructions, setInstructions] = useState('');
  const [drivers, setDrivers] = useState<MatchedDriver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [locating, setLocating] = useState<'pickup' | 'dropoff' | ''>('');
  const [matching, setMatching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setPickupAddress(defaultPickupAddress);
  }, [defaultPickupAddress]);

  useEffect(() => {
    setDropoffAddress(defaultDropoffAddress);
  }, [defaultDropoffAddress]);

  useEffect(() => {
    const point = toGeoPoint(defaultPickupLocation);
    if (point) setPickupLocation(point);
  }, [defaultPickupLocation]);

  useEffect(() => {
    const point = toGeoPoint(defaultDropoffLocation);
    if (point) setDropoffLocation(point);
  }, [defaultDropoffLocation]);

  const matchInput = useMemo(
    () => ({
      pickupLocation,
      dropoffLocation,
      packageType,
      packageWeight: Number(packageWeight || 0),
      packageValue,
      urgency
    }),
    [
      pickupLocation,
      dropoffLocation,
      packageType,
      packageWeight,
      packageValue,
      urgency
    ]
  );

  const recommendedVehicle = getVehicleRecommendation(matchInput);
  const estimatedFee = calculateDeliveryFee(
    pickupLocation,
    dropoffLocation,
    matchInput
  );
  const estimatedEta = calculateSmartETA(pickupLocation, dropoffLocation);
  const formattedFee = formatMoney(estimatedFee, activeCurrency, currencyLocale);

  useEffect(() => {
    if (!pickupLocation && !dropoffLocation) return;

    let active = true;

    const loadDrivers = async () => {
      setMatching(true);

      try {
        const bestDrivers = await findBestDriversForDelivery(matchInput, 5);
        if (!active) return;

        setDrivers(bestDrivers);
        setSelectedDriverId(bestDrivers[0]?.driverId || '');
      } catch (error) {
        console.error('Driver matching failed:', error);
      } finally {
        if (active) setMatching(false);
      }
    };

    loadDrivers();

    return () => {
      active = false;
    };
  }, [matchInput]);

  const useCurrentLocation = async (target: 'pickup' | 'dropoff') => {
    setLocating(target);
    setMessage('');

    try {
      const location = await requestBrowserLocation();

      if (target === 'pickup') {
        setPickupLocation(location);
        if (!pickupAddress) setPickupAddress('Current pickup GPS location');
      } else {
        setDropoffLocation(location);
        if (!dropoffAddress) setDropoffAddress('Current dropoff GPS location');
      }
    } catch (error) {
      console.error('Location failed:', error);
      setMessage('Location unavailable. You can still type the address manually.');
    } finally {
      setLocating('');
    }
  };

  const submitRequest = async () => {
    if (!pickupAddress.trim() || !dropoffAddress.trim()) {
      setMessage('Add pickup and dropoff addresses before requesting delivery.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const deliveryId = await createDeliveryRequest({
        tradeId,
        buyerId,
        sellerId,
        driverId: selectedDriverId || undefined,
        pickupLocation: pickupLocation || undefined,
        dropoffLocation: dropoffLocation || undefined,
        pickupAddress: pickupAddress.trim(),
        destinationAddress: dropoffAddress.trim(),
        packageType,
        packageWeight: Number(packageWeight || 0),
        packageValue,
        urgency,
        instructions,
        estimatedFee
      });

      setMessage('Delivery request created. Live tracking is now available.');
      onCreated?.(deliveryId);
    } catch (error) {
      console.error('Delivery request failed:', error);
      setMessage('Could not create delivery request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-500">
          <Truck className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-white">
            Request Delivery
          </h2>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
            Create an escrow-linked logistics order with live GPS tracking
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <Package className="mb-2 h-5 w-5 text-amber-500" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            Goods Value
          </p>
          <p className="mt-1 font-serif text-sm text-white">
            {formatMoney(packageValue, activeCurrency, currencyLocale)}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <Scale className="mb-2 h-5 w-5 text-amber-500" />
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
            Fee Currency
          </p>
          <p className="mt-1 font-serif text-sm text-white">
            {currencyLabel || activeCurrency}
          </p>
        </div>

        <div className="rounded-2xl border border-green-500/10 bg-green-500/5 p-4">
          <ShieldCheck className="mb-2 h-5 w-5 text-green-400" />
          <p className="text-[8px] font-black uppercase tracking-widest text-green-400">
            Escrow
          </p>
          <p className="mt-1 font-serif text-sm text-white">
            Delivery linked
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-green-400" />
              Pickup Location
            </label>

            <span
              className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${
                pickupLocation
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}
            >
              {pickupLocation ? 'GPS Ready' : 'Address Only'}
            </span>
          </div>

          <input
            value={pickupAddress}
            onChange={event => setPickupAddress(event.target.value)}
            placeholder="Farm, market, warehouse, village..."
            className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
          />

          <button
            type="button"
            onClick={() => useCurrentLocation('pickup')}
            disabled={locating === 'pickup'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-500/20 bg-green-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-green-400 disabled:opacity-50"
          >
            {locating === 'pickup' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
            Use Pickup GPS
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-amber-500" />
              Dropoff Location
            </label>

            <span
              className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${
                dropoffLocation
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}
            >
              {dropoffLocation ? 'GPS Ready' : 'Address Only'}
            </span>
          </div>

          <input
            value={dropoffAddress}
            onChange={event => setDropoffAddress(event.target.value)}
            placeholder="Buyer address, depot, market..."
            className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
          />

          <button
            type="button"
            onClick={() => useCurrentLocation('dropoff')}
            disabled={locating === 'dropoff'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 py-3 text-[9px] font-black uppercase tracking-widest text-amber-400 disabled:opacity-50"
          >
            {locating === 'dropoff' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
            Use Dropoff GPS
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-2 block text-[9px] font-black uppercase tracking-widest text-slate-500">
            Package Type
          </label>
          <select
            value={packageType}
            onChange={event => setPackageType(event.target.value)}
            className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
          >
            {packageTypes.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[9px] font-black uppercase tracking-widest text-slate-500">
            Weight KG
          </label>
          <input
            value={packageWeight}
            onChange={event => setPackageWeight(event.target.value)}
            type="number"
            min="0"
            className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
          />
        </div>

        <div>
          <label className="mb-2 block text-[9px] font-black uppercase tracking-widest text-slate-500">
            Urgency
          </label>
          <select
            value={urgency}
            onChange={event => setUrgency(event.target.value)}
            className="w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
          >
            {urgencyOptions.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <textarea
        value={instructions}
        onChange={event => setInstructions(event.target.value)}
        placeholder="Delivery instructions, pickup contact, fragile goods, market gate..."
        className="min-h-24 w-full rounded-xl border border-white/5 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50"
      />

      <div className="grid gap-3 md:grid-cols-4">
        {[
          {
            label: 'Estimated Fee',
            value: formattedFee,
            icon: Scale
          },
          {
            label: 'Estimated ETA',
            value: `${estimatedEta} mins`,
            icon: Navigation
          },
          {
            label: 'Vehicle',
            value: recommendedVehicle,
            icon: Truck
          },
          {
            label: 'Escrow',
            value: 'Protected',
            icon: ShieldCheck
          }
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-4">
            <item.icon className="mb-2 h-5 w-5 text-amber-500" />
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
              {item.label}
            </p>
            <p className="mt-1 font-serif text-sm capitalize text-white">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Smart Driver Match
          </p>
          {matching && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {drivers.length > 0 ? (
            drivers.slice(0, 3).map(driver => (
              <motion.button
                key={driver.driverId}
                type="button"
                whileHover={{ y: -2 }}
                onClick={() => setSelectedDriverId(driver.driverId)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedDriverId === driver.driverId
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-white/5 bg-black/30 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={
                      driver.photoURL ||
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.driverId}`
                    }
                    alt={driver.displayName || driver.name || 'Driver'}
                    className="h-10 w-10 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <p className="font-serif text-sm text-white">
                      {driver.displayName || driver.name || 'Driver'}
                    </p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-green-400">
                      {driver.pickupEtaLabel}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] uppercase text-slate-400">
                    {driver.driverLevel}
                  </span>
                  <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[8px] uppercase text-amber-400">
                    Score {driver.matchScore}
                  </span>
                </div>
              </motion.button>
            ))
          ) : (
            <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-sm text-slate-500 md:col-span-3">
              Drivers will appear after pickup or dropoff GPS is available. You can still create the order and match later.
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {message}
        </div>
      )}

      <button
        type="button"
        onClick={submitRequest}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400 disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <Sparkles className="h-5 w-5" />
            Create Logistics Order
          </>
        )}
      </button>

      <div className="flex items-start gap-3 rounded-2xl border border-green-500/10 bg-green-500/5 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
        <p className="text-xs leading-relaxed text-slate-400">
          This creates a delivery request, logistics order, escrow-linked shipment,
          live tracking record, driver notification, and delivery history event.
        </p>
      </div>
    </section>
  );
}
