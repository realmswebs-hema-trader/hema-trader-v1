import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  limit,
  doc,
  setDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MapPin,
  Navigation,
  Package,
  WifiOff,
  X
} from 'lucide-react';

import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { db, storage } from '../lib/firebase';

interface ListingGpsLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source: 'profile' | 'browser';
}

type InventoryType = 'single' | 'stock';

const countryCurrencyMap: Record<string, { code: string; locale: string; label: string }> = {
  cameroon: { code: 'XAF', locale: 'fr-CM', label: 'XAF / FCFA' },
  nigeria: { code: 'NGN', locale: 'en-NG', label: 'NGN' },
  ghana: { code: 'GHS', locale: 'en-GH', label: 'GHS' },
  kenya: { code: 'KES', locale: 'en-KE', label: 'KES' },
  uganda: { code: 'UGX', locale: 'en-UG', label: 'UGX' },
  tanzania: { code: 'TZS', locale: 'sw-TZ', label: 'TZS' },
  rwanda: { code: 'RWF', locale: 'rw-RW', label: 'RWF' },
  cote_d_ivoire: { code: 'XOF', locale: 'fr-CI', label: 'XOF / CFA' },
  senegal: { code: 'XOF', locale: 'fr-SN', label: 'XOF / CFA' },
  south_africa: { code: 'ZAR', locale: 'en-ZA', label: 'ZAR' },
  united_states: { code: 'USD', locale: 'en-US', label: 'USD' }
};

const inventoryOptions: Array<{
  value: InventoryType;
  label: string;
  helper: string;
}> = [
  {
    value: 'single',
    label: 'Single Product',
    helper: 'Only one buyer can trade for this item. Once sold, it is closed.'
  },
  {
    value: 'stock',
    label: 'In Stock / Multiple Available',
    helper: 'Multiple buyers may request this product while stock is available.'
  }
];

const safeCoordinate = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCountryKey = (country?: string) =>
  (country || 'Cameroon')
    .toLowerCase()
    .trim()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getCurrencyInfo = (profile: any) => {
  if (profile?.currency || profile?.currencyCode) {
    return {
      code: profile.currency || profile.currencyCode,
      locale: profile.currencyLocale || 'fr-CM',
      label: profile.currencyLabel || profile.currency || profile.currencyCode
    };
  }

  const countryKey = normalizeCountryKey(profile?.country);
  return countryCurrencyMap[countryKey] || countryCurrencyMap.cameroon;
};

const formatMoney = (
  amount: number,
  currencyCode: string,
  locale: string
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

export default function CreateListing() {
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();
  const navigate = useNavigate();

  const currencyInfo = getCurrencyInfo(profile);

  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [uploadWarning, setUploadWarning] = useState('');
  const [gpsLocation, setGpsLocation] = useState<ListingGpsLocation | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    quantity: '',
    category: 'Animals',
    location: '',
    inventoryType: 'single' as InventoryType
  });

  const [metadata, setMetadata] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const profileLatitude = safeCoordinate(profile?.latitude);
  const profileLongitude = safeCoordinate(profile?.longitude);

  const activeLocation =
    gpsLocation ||
    (profileLatitude !== null && profileLongitude !== null
      ? {
          latitude: profileLatitude,
          longitude: profileLongitude,
          source: 'profile' as const
        }
      : null);

  useEffect(() => {
    return () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const requestListingLocation = async () => {
    if (!navigator.geolocation) {
      setGpsError('GPS is not supported on this device.');
      return;
    }

    setGpsLoading(true);
    setGpsError('');

    navigator.geolocation.getCurrentPosition(
      async position => {
        const nextLocation: ListingGpsLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'browser'
        };

        setGpsLocation(nextLocation);

        if (!formData.location.trim()) {
          setFormData(prev => ({
            ...prev,
            location: 'GPS market location'
          }));
        }

        if (user) {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              latitude: nextLocation.latitude,
              longitude: nextLocation.longitude,
              currentLocation: {
                latitude: nextLocation.latitude,
                longitude: nextLocation.longitude
              },
              locationUpdatedAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        }

        setGpsLoading(false);
      },
      error => {
        console.error('Listing GPS failed:', error);
        setGpsError('Location unavailable. Allow GPS from your browser address bar.');
        setGpsLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      }
    );
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadWarning('');

      const newFiles = Array.from(e.target.files);
      setImages(prev => [...prev, ...newFiles]);

      const newUrls = newFiles.map(file => URL.createObjectURL(file));
      setPreviewUrls(prev => [...prev, ...newUrls]);
    }
  };

  const removeImage = (index: number) => {
    URL.revokeObjectURL(previewUrls[index]);

    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const uploadListingImagesSafely = async () => {
    const imageUrls: string[] = [];
    const failedImageNames: string[] = [];
    const sellerId = profile?.userId || user?.uid || 'unknown';

    for (const image of images) {
      try {
        const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const imageRef = ref(
          storage,
          `listings/${sellerId}/${Date.now()}_${safeName}`
        );

        const snapshot = await uploadBytes(imageRef, image);
        const url = await getDownloadURL(snapshot.ref);

        imageUrls.push(url);
      } catch (uploadError) {
        console.error('Image upload failed:', uploadError);
        failedImageNames.push(image.name);
      }
    }

    return {
      imageUrls,
      failedImageNames
    };
  };

  const notifyFollowersOfNewListing = async (listingId: string) => {
    if (!user) return;

    try {
      const followersQ = query(
        collection(db, 'follows'),
        where('followingId', '==', user.uid),
        limit(100)
      );

      const followersSnap = await getDocs(followersQ);
      const followerIds = Array.from(
        new Set(
          followersSnap.docs
            .map(followerDoc => followerDoc.data().followerId)
            .filter((followerId: string) => followerId && followerId !== user.uid)
        )
      );

      if (followerIds.length === 0) return;

      const sellerName =
        profile?.displayName ||
        profile?.name ||
        user.displayName ||
        'A seller you follow';

      const listingTitle = formData.title.trim() || 'a new product';

      await Promise.allSettled(
        followerIds.map(followerId =>
          sendNotification(followerId, {
            title: `New from ${sellerName}`,
            body: `${sellerName} posted ${listingTitle}.`,
            type: 'new_listing',
            targetId: listingId,
            targetType: 'listing',
            actionUrl: `/listing/${listingId}`,
            senderId: user.uid,
            senderName: sellerName
          })
        )
      );
    } catch (notificationError) {
      console.error('Follower notification failed:', notificationError);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!profile || !user) return;

    if (profile.verificationStatus !== 'verified') {
      const proceed = window.confirm(
        'Your account is not verified yet. You can still list items and trade, but buyers will see you as an unverified seller until you complete verification.\n\nContinue posting this listing?'
      );

      if (!proceed) return;
    }

    setLoading(true);
    setUploadWarning('');

    try {
      const { imageUrls, failedImageNames } = await uploadListingImagesSafely();

      if (failedImageNames.length > 0) {
        setUploadWarning(
          `Listing will be posted, but ${failedImageNames.length} photo upload failed.`
        );
        console.warn(
          `Listing created, but ${failedImageNames.length} image upload(s) failed.`
        );
      }

      const sellerId = profile.userId || user.uid;
      const listingLatitude = activeLocation?.latitude ?? null;
      const listingLongitude = activeLocation?.longitude ?? null;
      const priceValue = parseFloat(formData.price) || 0;

      const imageUploadStatus =
        images.length === 0
          ? 'none'
          : failedImageNames.length === 0
            ? 'uploaded'
            : imageUrls.length > 0
              ? 'partial'
              : 'failed';

      const listingDoc = await addDoc(collection(db, 'listings'), {
        ownerId: sellerId,
        sellerId,
        title: formData.title.trim(),
        description: formData.description.trim(),
        price: priceValue,
        priceDisplay: formatMoney(priceValue, currencyInfo.code, currencyInfo.locale),
        currency: currencyInfo.code,
        currencyCode: currencyInfo.code,
        currencyLocale: currencyInfo.locale,
        currencyLabel: currencyInfo.label,
        country: profile?.country || 'Cameroon',
        quantity: formData.quantity.trim(),
        category: formData.category,
        metadata,
        inventoryType: formData.inventoryType,
        listingStatus: 'available',
        activeTradeId: null,
        soldAt: null,
        reservedAt: null,
        location: formData.location.trim(),
        locationName: formData.location.trim(),
        latitude: listingLatitude,
        longitude: listingLongitude,
        currentLocation:
          listingLatitude !== null && listingLongitude !== null
            ? {
                latitude: listingLatitude,
                longitude: listingLongitude
              }
            : null,
        gpsAccuracy: gpsLocation?.accuracy || null,
        gpsSource: activeLocation?.source || 'missing',
        isGeoTagged: listingLatitude !== null && listingLongitude !== null,
        images: imageUrls,
        imageUploadStatus,
        failedImageNames,
        status: 'active',
        stockStatus: 'in_stock',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await notifyFollowersOfNewListing(listingDoc.id);

      navigate('/');
    } catch (error) {
      console.error('Submit error', error);
      alert('Listing authorization failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header className="px-2">
        <h2 className="font-serif text-4xl text-white">Create New Listing</h2>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
          Share your products with the marketplace
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl"
      >
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div
                className={`mt-1 rounded-xl p-2 ${
                  activeLocation
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-amber-500/10 text-amber-500'
                }`}
              >
                {activeLocation ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <MapPin className="h-5 w-5" />
                )}
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white">
                  Listing GPS
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {activeLocation
                    ? `Geo-tag ready from ${activeLocation.source}. Your listing can appear on marketplace maps.`
                    : 'Add GPS so buyers and drivers can discover this listing nearby.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={requestListingLocation}
              disabled={gpsLoading}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl disabled:opacity-50"
            >
              {gpsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Navigation className="h-4 w-4" />
              )}
              Use My GPS
            </button>
          </div>

          {activeLocation && (
            <div className="mt-4 grid gap-3 border-t border-white/5 pt-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Latitude
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {activeLocation.latitude.toFixed(5)}
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Longitude
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {activeLocation.longitude.toFixed(5)}
                </p>
              </div>
            </div>
          )}

          {gpsError && (
            <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-300">
              <WifiOff className="h-4 w-4 shrink-0" />
              {gpsError}
            </div>
          )}

          {!activeLocation && !gpsError && (
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                Location coordinates missing. Distance filtering and map discovery will be limited.
              </p>
            </div>
          )}
        </div>

        {uploadWarning && (
          <div className="flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-sm text-amber-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {uploadWarning}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Photos
            </label>
            <span className="text-right text-[8px] font-bold uppercase tracking-widest text-slate-600">
              Recommended for trust
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {previewUrls.map((url, i) => (
              <div
                key={url}
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/5 bg-black/40"
              >
                <img
                  src={url}
                  alt="Preview"
                  className="h-full w-full object-cover grayscale-[0.3] transition-all group-hover:grayscale-0"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] transition-all hover:border-amber-500/50 hover:bg-amber-500/5"
            >
              <ImagePlus className="mb-2 h-6 w-6 text-slate-700 group-hover:text-amber-500" />
              <span className="text-[9px] font-black uppercase tracking-tighter text-slate-600 group-hover:text-amber-500">
                Append Image
              </span>
            </button>
          </div>

          <input
            type="file"
            hidden
            ref={fileInputRef}
            onChange={handleImageChange}
            multiple
            accept="image/*"
          />
        </div>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Inventory Type
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {inventoryOptions.map(option => {
              const selected = formData.inventoryType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setFormData(prev => ({
                      ...prev,
                      inventoryType: option.value
                    }))
                  }
                  className={`flex min-h-32 flex-col items-start justify-between rounded-2xl border p-4 text-left transition-all ${
                    selected
                      ? 'border-amber-500 bg-amber-500/10 shadow-[0_0_24px_rgba(245,158,11,0.08)]'
                      : 'border-white/5 bg-black/30 hover:border-white/15'
                  }`}
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="rounded-xl bg-white/5 p-2">
                      <Package className={`h-5 w-5 ${selected ? 'text-amber-400' : 'text-slate-500'}`} />
                    </div>

                    <span
                      className={`h-4 w-4 rounded-full border ${
                        selected
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-white/20 bg-black'
                      }`}
                    />
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">
                      {option.label}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      {option.helper}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Title
          </label>
          <input
            required
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g. Organic Hybrid Maize, Brahman Bull..."
            className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Price ({currencyInfo.label})
            </label>
            <input
              required
              type="number"
              value={formData.price}
              onChange={e => setFormData({ ...formData, price: e.target.value })}
              placeholder={`Example: ${formatMoney(45000, currencyInfo.code, currencyInfo.locale)}`}
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Quantity
            </label>
            <input
              required
              type="text"
              value={formData.quantity}
              onChange={e => setFormData({ ...formData, quantity: e.target.value })}
              placeholder={
                formData.inventoryType === 'single'
                  ? 'e.g. 1 unit'
                  : 'e.g. 50 Bags, 20 Heads...'
              }
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Category
            </label>
            <select
              value={formData.category}
              onChange={e => {
                setFormData({ ...formData, category: e.target.value });
                setMetadata({});
              }}
              className="w-full appearance-none rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white focus:border-amber-500/50 focus:outline-none"
            >
              {['Animals', 'Farming Products', 'Electronics', 'Equipment', 'Seeds'].map(category => (
                <option key={category} value={category} className="bg-brand-card">
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Location
            </label>
            <input
              required
              type="text"
              value={formData.location}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              placeholder="District, Village..."
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
        </div>

        {formData.category === 'Animals' && (
          <div className="grid grid-cols-3 gap-4">
            {['Breed', 'Age', 'Weight'].map(field => (
              <div key={field} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {field}
                </label>
                <input
                  type="text"
                  value={metadata[field] || ''}
                  onChange={e => setMetadata({ ...metadata, [field]: e.target.value })}
                  placeholder={field}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        {formData.category === 'Seeds' && (
          <div className="grid grid-cols-2 gap-4">
            {['Variety', 'Germination %'].map(field => (
              <div key={field} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {field}
                </label>
                <input
                  type="text"
                  value={metadata[field] || ''}
                  onChange={e => setMetadata({ ...metadata, [field]: e.target.value })}
                  placeholder={field}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        {['Electronics', 'Equipment'].includes(formData.category) && (
          <div className="grid grid-cols-2 gap-4">
            {['Year/Model', 'Condition'].map(field => (
              <div key={field} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {field}
                </label>
                <input
                  type="text"
                  value={metadata[field] || ''}
                  onChange={e => setMetadata({ ...metadata, [field]: e.target.value })}
                  placeholder={field}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Description
          </label>
          <textarea
            required
            rows={4}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe quality, condition, and any other important details..."
            className="w-full resize-none rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
          />
        </div>

        <button
          disabled={loading}
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl transition-all hover:bg-amber-500 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Post Listing'}
        </button>
      </form>
    </div>
  );
}
