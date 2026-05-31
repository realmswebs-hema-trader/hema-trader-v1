import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MapPin,
  Navigation,
  Package,
  Trash2,
  WifiOff,
  X
} from 'lucide-react';

import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { db } from '../lib/firebase';

interface ListingGpsLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source: 'profile' | 'browser';
}

type InventoryType = 'single' | 'stock';
type SellerSubscriptionPlan = 'free' | 'starter' | 'pro' | 'business';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 30000;

const sellerListingLimits: Record<SellerSubscriptionPlan, number> = {
  free: 5,
  starter: 25,
  pro: 100,
  business: Infinity
};

const lockedListingStatuses = ['in_trade', 'reserved', 'sold', 'completed'];

const listingCategories = [
  'Animals',
  'Farming Products',
  'Seeds',
  'Equipment',
  'Electronics',
  'Clothing',
  'Accessories'
];

const categoryMetadataFields: Record<string, string[]> = {
  Animals: ['Breed', 'Age', 'Weight'],
  Seeds: ['Variety', 'Germination %'],
  Electronics: ['Year/Model', 'Condition'],
  Equipment: ['Year/Model', 'Condition'],
  Clothing: ['Size', 'Brand', 'Condition', 'Color', 'Material', 'Gender/Audience'],
  Accessories: ['Type', 'Brand', 'Condition', 'Color', 'Material']
};

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

const formatMoney = (amount: number, currencyCode: string, locale: string) => {
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

const cleanMetadata = (metadata: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(metadata)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
  );

const getSellerPlan = (profile: any): SellerSubscriptionPlan => {
  const plan = profile?.subscription?.plan;

  if (plan === 'starter' || plan === 'pro' || plan === 'business') {
    return plan;
  }

  return 'free';
};

const getListingLimitMessage = (plan: SellerSubscriptionPlan) => {
  if (plan === 'free') {
    return 'You have reached your free listing limit. Upgrade to Starter to add more products.';
  }

  if (plan === 'starter') {
    return 'You have reached your Starter listing limit. Upgrade to Pro to add more products.';
  }

  if (plan === 'pro') {
    return 'You have reached your Pro listing limit. Upgrade to Business to add more products.';
  }

  return 'Your current plan does not allow more listings.';
};

const getTitlePlaceholder = (category: string) => {
  if (category === 'Clothing') return 'e.g. Ankara dress, denim jacket, sneakers...';
  if (category === 'Accessories') return 'e.g. Leather handbag, watch, necklace...';
  if (category === 'Seeds') return 'e.g. Hybrid maize seeds, tomato seeds...';
  if (category === 'Electronics') return 'e.g. Solar lamp, irrigation controller...';
  if (category === 'Equipment') return 'e.g. Water pump, tractor attachment...';

  return 'e.g. Organic Hybrid Maize, Brahman Bull...';
};

const getQuantityPlaceholder = (category: string, inventoryType: InventoryType) => {
  if (inventoryType === 'single') {
    if (category === 'Clothing') return 'e.g. 1 dress, 1 pair';
    if (category === 'Accessories') return 'e.g. 1 bag, 1 watch';
    return 'e.g. 1 unit';
  }

  if (category === 'Clothing') return 'e.g. 20 pieces, 12 pairs';
  if (category === 'Accessories') return 'e.g. 15 bags, 30 pieces';
  if (category === 'Animals') return 'e.g. 20 Heads';
  if (category === 'Seeds') return 'e.g. 50 packets, 30 bags';

  return 'e.g. 50 Bags, 20 Units...';
};

export default function CreateListing() {
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();
  const navigate = useNavigate();
  const params = useParams<Record<string, string | undefined>>();

  const editListingId = params.id || params.listingId || '';
  const isEditing = Boolean(editListingId);

  const currencyInfo = getCurrencyInfo(profile);
  const sellerPlan = getSellerPlan(profile);
  const sellerLimit = sellerListingLimits[sellerPlan];

  const [pageLoading, setPageLoading] = useState(Boolean(editListingId));
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [uploadWarning, setUploadWarning] = useState('');
  const [tradeLockMessage, setTradeLockMessage] = useState('');
  const [existingListing, setExistingListing] = useState<any>(null);
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);
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
  const previewUrlsRef = useRef<string[]>([]);

  const profileLatitude = safeCoordinate(profile?.latitude);
  const profileLongitude = safeCoordinate(profile?.longitude);
  const metadataFields = categoryMetadataFields[formData.category] || [];

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
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const checkListingHasTrade = async (listingId: string, listingData?: any) => {
    if (!listingId) return false;

    if (
      listingData?.hasTradeHistory ||
      listingData?.activeTradeId ||
      lockedListingStatuses.includes(listingData?.status) ||
      lockedListingStatuses.includes(listingData?.listingStatus)
    ) {
      return true;
    }

    const tradeQuery = query(
      collection(db, 'trades'),
      where('listingId', '==', listingId),
      limit(1)
    );

    const tradeSnap = await getDocs(tradeQuery);
    return !tradeSnap.empty;
  };

  useEffect(() => {
    if (!editListingId) {
      setPageLoading(false);
      return;
    }

    if (!user) {
      setPageLoading(false);
      return;
    }

    let mounted = true;

    const loadListingForEdit = async () => {
      setPageLoading(true);

      try {
        const listingRef = doc(db, 'listings', editListingId);
        const listingSnap = await getDoc(listingRef);

        if (!listingSnap.exists()) {
          alert('Listing not found.');
          navigate('/profile');
          return;
        }

        const listingData = {
          id: listingSnap.id,
          ...listingSnap.data()
        } as any;

        const ownerId =
          listingData.ownerId ||
          listingData.sellerId ||
          listingData.userId ||
          listingData.createdBy;

        if (ownerId !== user.uid) {
          alert('You can only edit your own listings.');
          navigate('/');
          return;
        }

        const hasTrade = await checkListingHasTrade(editListingId, listingData);

        if (!mounted) return;

        setExistingListing(listingData);
        setExistingImageUrls(listingData.images || listingData.imageUrls || []);
        setTradeLockMessage(
          hasTrade
            ? 'This listing already has a trade record. Editing and deletion are locked to protect buyers and escrow records.'
            : ''
        );

        setFormData({
          title: listingData.title || listingData.name || listingData.productName || '',
          description: listingData.description || '',
          price: String(listingData.price || listingData.amount || listingData.priceValue || ''),
          quantity: String(listingData.quantity || ''),
          category: listingData.category || 'Animals',
          location: listingData.locationName || listingData.location || '',
          inventoryType:
            listingData.inventoryType === 'stock' ||
            listingData.inventoryType === 'multiple'
              ? 'stock'
              : 'single'
        });

        setMetadata(listingData.metadata || {});

        if (
          typeof listingData.latitude === 'number' &&
          typeof listingData.longitude === 'number'
        ) {
          setGpsLocation({
            latitude: listingData.latitude,
            longitude: listingData.longitude,
            accuracy: listingData.gpsAccuracy || undefined,
            source: 'profile'
          });
        }
      } catch (error) {
        console.error('Listing edit load failed:', error);
        alert('Could not load listing for editing.');
        navigate('/profile');
      } finally {
        if (mounted) setPageLoading(false);
      }
    };

    loadListingForEdit();

    return () => {
      mounted = false;
    };
  }, [editListingId, user?.uid, navigate]);

  const validateSellerListingLimit = async () => {
    if (isEditing) return;
    if (!user) return;

    const limitForPlan = sellerListingLimits[getSellerPlan(profile)];

    if (limitForPlan === Infinity) return;

    const activeListingsQuery = query(
      collection(db, 'listings'),
      where('sellerId', '==', user.uid),
      where('status', '==', 'active'),
      limit(limitForPlan + 1)
    );

    const activeListingsSnap = await getDocs(activeListingsQuery);

    if (activeListingsSnap.size >= limitForPlan) {
      throw new Error(getListingLimitMessage(getSellerPlan(profile)));
    }
  };

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
    if (!e.target.files || tradeLockMessage) return;

    setUploadWarning('');

    const newFiles = Array.from(e.target.files).filter(file =>
      file.type.startsWith('image/')
    );

    const oversizedFiles = newFiles.filter(file => file.size > MAX_IMAGE_BYTES);
    const acceptedFiles = newFiles.filter(file => file.size <= MAX_IMAGE_BYTES);

    if (oversizedFiles.length > 0) {
      setUploadWarning('Some photos were skipped because they are larger than 5 MB.');
    }

    if (acceptedFiles.length === 0) {
      e.target.value = '';
      return;
    }

    setImages(prev => [...prev, ...acceptedFiles]);

    const newUrls = acceptedFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => [...prev, ...newUrls]);

    e.target.value = '';
  };

  const removeImage = (index: number) => {
    if (tradeLockMessage) return;

    URL.revokeObjectURL(previewUrls[index]);

    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = (index: number) => {
    if (tradeLockMessage) return;

    setExistingImageUrls(prev => prev.filter((_, i) => i !== index));
  };

  const uploadListingImagesSafely = async () => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

    const imageUrls: string[] = [];
    const failedImageNames: string[] = [];

    if (images.length === 0) {
      return {
        imageUrls,
        failedImageNames
      };
    }

    if (!cloudName || !uploadPreset) {
      console.error('Cloudinary environment variables are missing.');
      return {
        imageUrls,
        failedImageNames: images.map(image => image.name)
      };
    }

    for (const image of images) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, CLOUDINARY_UPLOAD_TIMEOUT_MS);

      try {
        const cloudinaryForm = new FormData();
        cloudinaryForm.append('file', image);
        cloudinaryForm.append('upload_preset', uploadPreset);
        cloudinaryForm.append(
          'folder',
          `hema-trader/listings/${user?.uid || 'unknown'}`
        );

        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          {
            method: 'POST',
            body: cloudinaryForm,
            signal: controller.signal
          }
        );

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.secure_url) {
          throw new Error(
            result?.error?.message ||
              `Cloudinary upload failed with status ${response.status}`
          );
        }

        imageUrls.push(result.secure_url);
      } catch (uploadError) {
        console.error('Cloudinary image upload failed:', uploadError);
        failedImageNames.push(image.name);
      } finally {
        window.clearTimeout(timeoutId);
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
            type: 'system',
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

  const handleDeleteListing = async () => {
    if (!user || !editListingId || !existingListing) return;

    setLoading(true);

    try {
      const hasTrade = await checkListingHasTrade(editListingId, existingListing);

      if (hasTrade) {
        const message =
          'You cannot delete this listing because a trade has already been opened on it. This protects buyers, sellers, and escrow records.';

        setTradeLockMessage(message);
        alert(message);
        return;
      }

      const confirmed = window.confirm(
        'Delete this listing? This cannot be undone.'
      );

      if (!confirmed) return;

      await deleteDoc(doc(db, 'listings', editListingId));
      alert('Listing deleted.');
      navigate('/profile');
    } catch (error) {
      console.error('Delete listing failed:', error);
      alert('Could not delete listing. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveEditedListing = async (
    listingLatitude: number | null,
    listingLongitude: number | null,
    priceValue: number,
    imageUrls: string[],
    failedImageNames: string[]
  ) => {
    if (!editListingId) return;

    const nextImages = [...existingImageUrls, ...imageUrls];

    const nextImageUploadStatus =
      failedImageNames.length > 0
        ? nextImages.length > 0
          ? 'partial'
          : 'failed'
        : nextImages.length > 0
          ? 'uploaded'
          : 'none';

    await updateDoc(doc(db, 'listings', editListingId), {
      title: formData.title.trim(),
      description: formData.description.trim(),
      price: priceValue,
      priceDisplay: formatMoney(priceValue, currencyInfo.code, currencyInfo.locale),

      currency: currencyInfo.code,
      currencyCode: currencyInfo.code,
      currencyLocale: currencyInfo.locale,
      currencyLabel: currencyInfo.label,
      country: profile?.country || existingListing?.country || 'Cameroon',

      quantity: formData.quantity.trim(),
      category: formData.category,
      metadata: cleanMetadata(metadata),
      inventoryType: formData.inventoryType,

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
      gpsSource: activeLocation?.source || existingListing?.gpsSource || 'missing',
      isGeoTagged: listingLatitude !== null && listingLongitude !== null,

      images: nextImages,
      imageUrls: nextImages,
      imageUploadStatus: nextImageUploadStatus,
      failedImageNames,

      editCount: increment(1),
      lastEditedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    alert('Listing updated.');
    navigate(`/listing/${editListingId}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      alert('Please sign in before posting a listing.');
      return;
    }

    if (tradeLockMessage) {
      alert(tradeLockMessage);
      return;
    }

    if (profile?.verificationStatus && profile.verificationStatus !== 'verified') {
      const proceed = window.confirm(
        'Your account is not verified yet. You can still list items and trade, but buyers will see you as an unverified seller until you complete verification.\n\nContinue?'
      );

      if (!proceed) return;
    }

    setLoading(true);
    setUploadWarning('');

    try {
      await validateSellerListingLimit();

      if (isEditing && editListingId) {
        const hasTrade = await checkListingHasTrade(editListingId, existingListing);

        if (hasTrade) {
          const message =
            'You cannot edit this listing because a trade has already been opened on it.';

          setTradeLockMessage(message);
          throw new Error(message);
        }
      }

      const { imageUrls, failedImageNames } = await uploadListingImagesSafely();

      if (
        images.length > 0 &&
        failedImageNames.length === images.length &&
        (!isEditing || existingImageUrls.length === 0)
      ) {
        throw new Error(
          'Photo upload failed. Please try again, or remove the photos and post the listing without images.'
        );
      }

      if (failedImageNames.length > 0) {
        setUploadWarning(
          `Listing will be saved, but ${failedImageNames.length} photo upload failed.`
        );
        console.warn(
          `Listing saved, but ${failedImageNames.length} image upload(s) failed.`
        );
      }

      const sellerId = user.uid;
      const listingLatitude = activeLocation?.latitude ?? null;
      const listingLongitude = activeLocation?.longitude ?? null;
      const priceValue = parseFloat(formData.price) || 0;

      if (isEditing) {
        await saveEditedListing(
          listingLatitude,
          listingLongitude,
          priceValue,
          imageUrls,
          failedImageNames
        );
        return;
      }

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
        userId: sellerId,
        createdBy: sellerId,

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
        metadata: cleanMetadata(metadata),
        inventoryType: formData.inventoryType,

        sellerSubscriptionPlan: sellerPlan,
        listingLimitAtCreation: sellerLimit === Infinity ? null : sellerLimit,

        boost: {
          isBoosted: false,
          boostType: null,
          startedAt: null,
          expiresAt: null,
          amountPaid: 0
        },

        editCount: 0,
        lastEditedAt: null,
        hasTradeHistory: false,
        activeTradeId: null,

        listingStatus: 'available',
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
        imageUrls,
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
      alert(
        error instanceof Error
          ? `Listing failed: ${error.message}`
          : 'Listing failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header className="px-2">
        <h2 className="font-serif text-4xl text-white">
          {isEditing ? 'Edit Listing' : 'Create New Listing'}
        </h2>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">
          {isEditing
            ? 'Update your product details before a trade begins'
            : 'Share your products with the marketplace'}
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
              disabled={gpsLoading || Boolean(tradeLockMessage)}
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

        {tradeLockMessage && (
          <div className="flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {tradeLockMessage}
          </div>
        )}

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
              Up to 5 MB each
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {existingImageUrls.map((url, i) => (
              <div
                key={url}
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/5 bg-black/40"
              >
                <img
                  src={url}
                  alt="Existing listing"
                  className="h-full w-full object-cover grayscale-[0.3] transition-all group-hover:grayscale-0"
                />
                {!tradeLockMessage && (
                  <button
                    type="button"
                    onClick={() => removeExistingImage(i)}
                    className="absolute right-2 top-2 rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}

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

            {!tradeLockMessage && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] transition-all hover:border-amber-500/50 hover:bg-amber-500/5"
              >
                <ImagePlus className="mb-2 h-6 w-6 text-slate-700 group-hover:text-amber-500" />
                <span className="text-[9px] font-black uppercase tracking-tighter text-slate-600 group-hover:text-amber-500">
                  Add Photo
                </span>
              </button>
            )}
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
                  disabled={Boolean(tradeLockMessage)}
                  onClick={() =>
                    setFormData(prev => ({
                      ...prev,
                      inventoryType: option.value
                    }))
                  }
                  className={`flex min-h-32 flex-col items-start justify-between rounded-2xl border p-4 text-left transition-all disabled:opacity-60 ${
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
            disabled={Boolean(tradeLockMessage)}
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            placeholder={getTitlePlaceholder(formData.category)}
            className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
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
              disabled={Boolean(tradeLockMessage)}
              type="number"
              value={formData.price}
              onChange={e => setFormData({ ...formData, price: e.target.value })}
              placeholder={`Example: ${formatMoney(45000, currencyInfo.code, currencyInfo.locale)}`}
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Quantity
            </label>
            <input
              required
              disabled={Boolean(tradeLockMessage)}
              type="text"
              value={formData.quantity}
              onChange={e => setFormData({ ...formData, quantity: e.target.value })}
              placeholder={getQuantityPlaceholder(formData.category, formData.inventoryType)}
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="space-y-4">
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Category
            </label>
            <select
              disabled={Boolean(tradeLockMessage)}
              value={formData.category}
              onChange={e => {
                setFormData({ ...formData, category: e.target.value });
                setMetadata({});
              }}
              className="w-full appearance-none rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
            >
              {listingCategories.map(category => (
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
              disabled={Boolean(tradeLockMessage)}
              type="text"
              value={formData.location}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              placeholder="District, Village..."
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>

        {metadataFields.length > 0 && (
          <div
            className={
              metadataFields.length > 4
                ? 'grid grid-cols-2 gap-4 md:grid-cols-3'
                : 'grid grid-cols-2 gap-4'
            }
          >
            {metadataFields.map(field => (
              <div key={field} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  {field}
                </label>
                <input
                  disabled={Boolean(tradeLockMessage)}
                  type="text"
                  value={metadata[field] || ''}
                  onChange={e => setMetadata({ ...metadata, [field]: e.target.value })}
                  placeholder={field}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none disabled:opacity-60"
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
            disabled={Boolean(tradeLockMessage)}
            rows={4}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe quality, condition, and any other important details..."
            className="w-full resize-none rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none disabled:opacity-60"
          />
        </div>

        <button
          disabled={loading || Boolean(tradeLockMessage)}
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl transition-all hover:bg-amber-500 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isEditing ? (
            'Save Listing'
          ) : (
            'Post Listing'
          )}
        </button>

        {isEditing && (
          <button
            type="button"
            onClick={handleDeleteListing}
            disabled={loading || Boolean(tradeLockMessage)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 py-4 text-[10px] font-bold uppercase tracking-widest text-red-400 transition-all hover:bg-red-500 hover:text-white disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete Listing
          </button>
        )}
      </form>
    </div>
  );
}
