import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  ChevronRight,
  Clock,
  FileText,
  Flag,
  Globe2,
  KeyRound,
  Languages,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Truck,
  Upload,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  WalletCards,
  Zap
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { useAuth } from '../components/auth/AuthContext';
import { db, storage } from '../lib/firebase';
import { useNotifications } from '../components/notifications/NotificationContext';
import ProfileReviewsTab from '../components/reviews/ProfileReviewsTab';
import TrustCenterPanel from '../components/trust/TrustCenterPanel';
import VerificationCenterPanel from '../components/verification/VerificationCenterPanel';
import {
  FOUNDER_NAME,
  applyTrustPenalty,
  calculateTrustScore,
  isFounderProfile,
  isReservedFounderName,
  normalizeNameKey
} from '../services/trustScoreService';

type ProfileTab = 'listings' | 'reviews' | 'about' | 'deliveries' | 'activity';

interface ListingItem {
  id: string;
  title?: string;
  price?: number;
  images?: string[];
  status?: string;
  category?: string;
  deliveryAvailable?: boolean;
  escrowProtected?: boolean;
  verificationStatus?: string;
  createdAt?: any;
}

interface ActivityItem {
  id: string;
  type?: string;
  title?: string;
  body?: string;
  createdAt?: any;
}

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDate = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return 'Recently';

  return new Date(millis).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric'
  });
};

const formatLastActive = (profile: any) => {
  if (profile?.isOnline || profile?.online) return 'Active Now';

  const millis = getMillis(profile?.lastActiveAt);
  if (!millis) return 'Offline';

  const diff = Date.now() - millis;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'Active recently';
  if (minutes < 60) return `Last active ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last active ${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `Last active ${days}d ago`;
};

const normalizeRoles = (roles: unknown) =>
  Array.isArray(roles) ? roles.filter(role => typeof role === 'string') : [];

export default function Profile() {
  const { userId: urlUserId } = useParams();
  const {
    user: authUser,
    profile: myProfile,
    logout,
    updateRoles,
    updateProfilePhoto,
    updateDisplayName,
    updateAccountPassword,
    loading: authLoading
  } = useAuth();

  const { sendNotification } = useNotifications();

  const targetUserId = urlUserId || authUser?.uid;
  const isOwnProfile = !urlUserId || urlUserId === authUser?.uid;

  const [targetProfile, setTargetProfile] = useState<any>(null);
  const [profileOverlay, setProfileOverlay] = useState<any>({});
  const [listings, setListings] = useState<ListingItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activeTab, setActiveTab] = useState<ProfileTab>('listings');
  const [loading, setLoading] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  const [displayNameInput, setDisplayNameInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [tradeCategoryInput, setTradeCategoryInput] = useState('');
  const [tradeDescriptionInput, setTradeDescriptionInput] = useState('');
  const [languagesInput, setLanguagesInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      setLoading(true);

      try {
        const docRef = doc(db, 'users', targetUserId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setTargetProfile({
            userId: docSnap.id,
            uid: docSnap.id,
            ...docSnap.data()
          });
        }
      } catch (err) {
        console.error('Profile fetch fail', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [targetUserId]);

  useEffect(() => {
    if (!authUser || !targetUserId || isOwnProfile) return;

    const checkFollow = async () => {
      const followId = `${authUser.uid}_${targetUserId}`;
      const followSnap = await getDoc(doc(db, 'followers', followId));
      setIsFollowing(followSnap.exists());
    };

    checkFollow();
  }, [authUser, targetUserId, isOwnProfile]);

  useEffect(() => {
    if (!targetUserId) return;

    const unsubListings = onSnapshot(
      query(collection(db, 'listings'), where('ownerId', '==', targetUserId)),
      snapshot => {
        const next = snapshot.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ListingItem))
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

        setListings(next);
      },
      error => console.error('Profile listings sync failed:', error)
    );

    const unsubActivities = onSnapshot(
      query(collection(db, 'activities'), where('userId', '==', targetUserId)),
      snapshot => {
        const next = snapshot.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ActivityItem))
          .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

        setActivities(next);
      },
      error => console.error('Profile activities sync failed:', error)
    );

    return () => {
      unsubListings();
      unsubActivities();
    };
  }, [targetUserId]);

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-40">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        <p className="animate-pulse text-[10px] font-bold uppercase tracking-wider text-slate-600">
          Synchronizing profile...
        </p>
      </div>
    );
  }

  const fallbackOwnProfile = authUser
    ? {
        userId: authUser.uid,
        uid: authUser.uid,
        email: authUser.email,
        displayName:
          authUser.displayName ||
          authUser.email?.split('@')[0] ||
          'Profile',
        name:
          authUser.displayName ||
          authUser.email?.split('@')[0] ||
          'Profile',
        photoURL: authUser.photoURL || '',
        roles: [],
        ...(myProfile || {})
      }
    : null;

  const profileBase = isOwnProfile ? fallbackOwnProfile : targetProfile;
  const profile = profileBase ? { ...profileBase, ...profileOverlay } : null;

  const passwordProviderEnabled =
    authUser?.providerData?.some(provider => provider.providerId === 'password') ||
    false;

  if (!profile) {
    return (
      <div className="mx-auto max-w-md rounded-[3rem] border border-white/5 bg-brand-card p-8 py-32 text-center">
        <ShieldAlert className="mx-auto mb-6 h-16 w-16 text-red-500/20" />
        <h2 className="mb-2 font-serif text-2xl text-white">
          {isOwnProfile ? 'Please sign in again' : 'User not found'}
        </h2>
        <p className="text-[10px] font-bold uppercase leading-relaxed tracking-wider text-slate-500">
          {isOwnProfile
            ? "We couldn't verify your session. Please try logging back in."
            : 'The user you are looking for does not exist or has been removed.'}
        </p>
      </div>
    );
  }

  const roles = normalizeRoles(profile.roles);
  const founderAccount = isFounderProfile(profile);
  const canReportProfile = !isOwnProfile && Boolean(authUser) && !founderAccount;
  const canUnfollowProfile = !founderAccount;

  const identityVerified =
    Boolean(profile.identityVerified) ||
    profile.verificationStatus === 'verified' ||
    founderAccount;
  const driverVerified = Boolean(profile.driverVerified) || founderAccount;
  const phoneVerified = Boolean(profile.phoneVerified) || founderAccount;
  const isOnline = Boolean(profile.isOnline || profile.online) || founderAccount;
  const displayName = founderAccount
    ? FOUNDER_NAME
    : profile.displayName || profile.name || 'Hema User';
  const username =
    profile.username ||
    displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.$/, '');

  const rating = founderAccount
    ? 5
    : safeNumber(profile.averageRating || profile.avgDriverRating);

  const trustScore = founderAccount
    ? 100
    : safeNumber(profile.trustScore, calculateTrustScore(profile));

  const totalTrades = founderAccount
    ? Math.max(
        safeNumber(profile.totalTrades || profile.completedTrades || profile.successfulTrades),
        10
      )
    : profile.totalTrades || profile.completedTrades || profile.successfulTrades || 0;

  const totalSales = founderAccount
    ? Math.max(safeNumber(profile.totalSales || profile.salesCount), 10)
    : profile.totalSales || profile.salesCount || 0;

  const completedDeliveries = founderAccount
    ? Math.max(
        safeNumber(profile.completedDeliveries || profile.deliveriesCount),
        10
      )
    : profile.completedDeliveries || profile.deliveriesCount || 0;

  const responseRate = founderAccount ? 100 : profile.responseRate || 100;
  const responseTime = founderAccount
    ? 'Founder priority'
    : profile.responseTime || 'Usually replies fast';

  const deliverySuccessRate = founderAccount
    ? 100
    : profile.deliverySuccessRate ||
      profile.deliveryCompletionRate ||
      profile.reliabilityScore ||
      (profile.deliveriesCount ? 96 : 0);

  const escrowSuccessRate = founderAccount
    ? 100
    : profile.escrowSuccessRate || (totalTrades ? 98 : 0);

  const communityRatingPercent = founderAccount
    ? 100
    : Math.round((rating / 5) * 100);

  const toggleFollow = async () => {
    if (!authUser || !targetUserId || isOwnProfile) return;

    if (founderAccount && isFollowing) return;

    setFollowingLoading(true);

    const followId = `${authUser.uid}_${targetUserId}`;

    try {
      if (isFollowing && canUnfollowProfile) {
        await deleteDoc(doc(db, 'followers', followId));

        await updateDoc(doc(db, 'users', authUser.uid), {
          followingCount: increment(-1),
          updatedAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'users', targetUserId), {
          followersCount: increment(-1),
          updatedAt: serverTimestamp()
        });

        setIsFollowing(false);
        setTargetProfile((prev: any) => ({
          ...prev,
          followersCount: Math.max((prev?.followersCount || 1) - 1, 0)
        }));
      } else {
        await setDoc(doc(db, 'followers', followId), {
          followerId: authUser.uid,
          followingId: targetUserId,
          autoFollowedFounder: founderAccount,
          createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'users', authUser.uid), {
          followingCount: increment(1),
          updatedAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'users', targetUserId), {
          followersCount: increment(1),
          updatedAt: serverTimestamp()
        });

        setIsFollowing(true);
        setTargetProfile((prev: any) => ({
          ...prev,
          followersCount: (prev?.followersCount || 0) + 1
        }));

        await addDoc(collection(db, 'activities'), {
          userId: targetUserId,
          type: 'follow',
          title: 'New follower',
          body: `${myProfile?.displayName || 'Someone'} started following this profile.`,
          targetId: authUser.uid,
          createdAt: serverTimestamp()
        });

        sendNotification(targetUserId, {
          title: 'New Follower',
          body: `${myProfile?.displayName || 'Someone'} started following you.`,
          type: 'system',
          targetId: authUser.uid,
          targetType: 'profile',
          actionUrl: `/profile/${authUser.uid}`
        });
      }
    } catch (err) {
      console.error('Follow error:', err);
    } finally {
      setFollowingLoading(false);
    }
  };

  const handleReport = async () => {
    if (!authUser || !targetUserId || !reportReason || !canReportProfile) return;

    try {
      await addDoc(collection(db, 'reports'), {
        type: 'profile',
        reporterId: authUser.uid,
        targetId: targetUserId,
        reason: reportReason,
        description: reportDescription,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      try {
        const highRiskReport = ['fraud', 'scam', 'fake_products'].includes(reportReason);

        await applyTrustPenalty(targetUserId, {
          amount: highRiskReport ? 10 : 5,
          reason: `Profile report submitted: ${reportReason}`,
          eventType: 'report_received',
          metadata: {
            reporterId: authUser.uid,
            reason: reportReason
          },
          metricUpdates: {
            reportCount: increment(1),
            ...(highRiskReport ? { fraudReportCount: increment(1) } : {})
          }
        });
      } catch (trustErr) {
        console.error('Trust penalty failed after report:', trustErr);
      }

      alert('Report submitted successfully. Our safety team will review it.');
      setShowReportModal(false);
      setReportReason('');
      setReportDescription('');
    } catch (err) {
      console.error('Report error:', err);
      alert('Failed to submit report.');
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      const photoURL = await updateProfilePhoto(file);
      setProfileOverlay((prev: any) => ({ ...prev, photoURL }));
      setSettingsMessage('Profile photo updated successfully.');
    } catch (error) {
      console.error('Profile photo update failed:', error);
      setSettingsMessage('Could not update profile photo. Please try again.');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleBannerUpload = async (file: File) => {
    if (!authUser || !profile.userId) return;

    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const bannerRef = ref(storage, `profileBanners/${profile.userId}/${Date.now()}_${safeName}`);
      const uploadResult = await uploadBytes(bannerRef, file);
      const bannerURL = await getDownloadURL(uploadResult.ref);

      await updateDoc(doc(db, 'users', profile.userId), {
        bannerURL,
        updatedAt: serverTimestamp()
      });

      setProfileOverlay((prev: any) => ({ ...prev, bannerURL }));
      setSettingsMessage('Profile banner updated successfully.');
    } catch (error) {
      console.error('Banner upload failed:', error);
      setSettingsMessage('Could not update banner. Please try again.');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleDisplayNameUpdate = async () => {
    const nextName = displayNameInput.trim();
    if (!nextName) return;

    if (isReservedFounderName(nextName, authUser?.email)) {
      setSettingsMessage(`${FOUNDER_NAME} is reserved for the platform founder.`);
      return;
    }

    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      await updateDisplayName(nextName);

      await updateDoc(doc(db, 'users', profile.userId), {
        displayName: founderAccount ? FOUNDER_NAME : nextName,
        name: founderAccount ? FOUNDER_NAME : nextName,
        displayNameKey: normalizeNameKey(founderAccount ? FOUNDER_NAME : nextName),
        updatedAt: serverTimestamp()
      });

      setProfileOverlay((prev: any) => ({
        ...prev,
        displayName: founderAccount ? FOUNDER_NAME : nextName,
        name: founderAccount ? FOUNDER_NAME : nextName,
        displayNameKey: normalizeNameKey(founderAccount ? FOUNDER_NAME : nextName)
      }));

      setDisplayNameInput('');
      setSettingsMessage('Display name updated successfully.');
    } catch (error) {
      console.error('Display name update failed:', error);
      setSettingsMessage('Could not update display name. Please try again.');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handlePremiumSettingsUpdate = async () => {
    if (!authUser || !profile.userId) return;

    if (usernameInput.trim() && isReservedFounderName(usernameInput, authUser.email)) {
      setSettingsMessage(`${FOUNDER_NAME} is reserved for the platform founder.`);
      return;
    }

    setSettingsLoading(true);
    setSettingsMessage('');

    const languages = languagesInput
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    const updates: Record<string, any> = {
      updatedAt: serverTimestamp()
    };

    if (usernameInput.trim()) {
      updates.username = usernameInput.trim();
      updates.usernameKey = normalizeNameKey(usernameInput.trim());
    }

    if (bioInput.trim()) updates.bio = bioInput.trim();
    if (locationInput.trim()) updates.location = locationInput.trim();
    if (phoneInput.trim()) updates.phoneNumber = phoneInput.trim();
    if (tradeCategoryInput.trim()) updates.businessCategory = tradeCategoryInput.trim();
    if (tradeDescriptionInput.trim()) updates.businessDescription = tradeDescriptionInput.trim();
    if (languages.length > 0) updates.languages = languages;

    try {
      await updateDoc(doc(db, 'users', profile.userId), updates);

      setProfileOverlay((prev: any) => ({
        ...prev,
        ...updates,
        updatedAt: undefined
      }));

      setUsernameInput('');
      setBioInput('');
      setLocationInput('');
      setPhoneInput('');
      setTradeCategoryInput('');
      setTradeDescriptionInput('');
      setLanguagesInput('');
      setSettingsMessage('Profile details updated.');
    } catch (error) {
      console.error('Premium profile update failed:', error);
      setSettingsMessage('Could not update profile details.');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (passwordInput.length < 6) return;

    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      await updateAccountPassword(passwordInput);
      setPasswordInput('');
      setSettingsMessage('Password updated successfully.');
    } catch (error) {
      console.error('Password update failed:', error);
      setSettingsMessage(
        'Could not update password. Please sign out, sign back in, and try again.'
      );
    } finally {
      setSettingsLoading(false);
    }
  };

  const tabs: Array<{ id: ProfileTab; label: string; icon: any }> = [
    { id: 'listings', label: 'Listings', icon: ShoppingBag },
    { id: 'reviews', label: 'Reviews', icon: Star },
    { id: 'about', label: 'About', icon: FileText },
    { id: 'deliveries', label: 'Deliveries', icon: Truck },
    { id: 'activity', label: 'Activity', icon: Activity }
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl">
        <div
          className="relative h-48 bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/40 sm:h-64"
          style={
            profile.bannerURL
              ? {
                  backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.15)), url(${profile.bannerURL})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_35%)]" />

          {isOwnProfile && (
            <button
              onClick={() => bannerInputRef.current?.click()}
              className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white backdrop-blur-md hover:border-amber-500/40"
            >
              <Upload className="h-3.5 w-3.5" />
              Banner
            </button>
          )}

          <input
            ref={bannerInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={event =>
              event.target.files?.[0] && handleBannerUpload(event.target.files[0])
            }
          />
        </div>

        <div className="relative px-5 pb-8 sm:px-8">
          <div className="-mt-16 flex flex-col gap-5 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="relative">
                <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-brand-card bg-slate-900 shadow-2xl sm:h-40 sm:w-40">
                  <img
                    src={
                      profile.photoURL ||
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.userId || 'Hema'}`
                    }
                    alt={displayName}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>

                {identityVerified && (
                  <div className="absolute bottom-4 right-2 rounded-full bg-amber-500 p-2 text-black shadow-xl">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                )}

                <div className="absolute right-4 top-4 flex h-4 w-4">
                  {isOnline && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex h-4 w-4 rounded-full border-2 border-brand-card ${
                      isOnline ? 'bg-green-500' : 'bg-slate-500'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <h1 className="font-serif text-4xl text-white">
                      {displayName}
                    </h1>
                    {identityVerified && <ShieldCheck className="h-5 w-5 text-amber-500" />}
                  </div>
                  <p className="mt-1 text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">
                    @{username}
                  </p>
                </div>

                <p className="max-w-xl font-serif text-sm italic leading-relaxed text-slate-400">
                  {profile.bio ||
                    profile.businessDescription ||
                    (founderAccount
                      ? 'Founder of Hema Trader.'
                      : 'Growing trust inside the Hema Trader local trade network.')}
                </p>

                <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                  {founderAccount && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                      Founder
                    </span>
                  )}

                  {roles.map(role => (
                    <span
                      key={role}
                      className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${
                        role === 'admin'
                          ? 'border-red-500/20 bg-red-500/10 text-red-500'
                          : role === 'seller'
                            ? 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                            : role === 'driver'
                              ? 'border-green-500/20 bg-green-500/10 text-green-500'
                              : 'border-blue-500/20 bg-blue-500/10 text-blue-500'
                      }`}
                    >
                      {role}
                    </span>
                  ))}

                  {phoneVerified && (
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-500">
                      Phone Verified
                    </span>
                  )}

                  {driverVerified && (
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-500">
                      Verified Driver
                    </span>
                  )}

                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-slate-400">
                    {identityVerified ? 'Verified Identity' : 'Community Trader'}
                  </span>
                </div>

                <div className="flex flex-wrap justify-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 sm:justify-start">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-amber-500" />
                    {profile.location || profile.city || 'Cameroon'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-amber-500" />
                    Member since {formatDate(profile.createdAt)}
                  </span>
                  <span className={`flex items-center gap-1.5 ${isOnline ? 'text-green-500' : ''}`}>
                    <Clock className="h-3.5 w-3.5" />
                    {formatLastActive({ ...profile, isOnline })}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 sm:justify-end">
              {!isOwnProfile && authUser && (
                <>
                  <button
                    onClick={toggleFollow}
                    disabled={followingLoading || (founderAccount && isFollowing)}
                    className={`flex items-center gap-2 rounded-xl px-5 py-3 text-[10px] font-black uppercase tracking-widest transition ${
                      isFollowing
                        ? 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                        : 'bg-white text-black hover:bg-amber-500'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    {followingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isFollowing ? (
                      <>
                        <UserMinus className="h-4 w-4" />
                        {founderAccount ? 'Following Founder' : 'Unfollow'}
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        {founderAccount ? 'Follow Founder' : 'Follow'}
                      </>
                    )}
                  </button>

                  <Link
                    to={`/messages/${profile.userId}`}
                    className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:bg-amber-500 hover:text-black"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Message
                  </Link>

                  {roles.includes('driver') ? (
                    <Link
                      to={`/drivers/${profile.userId}`}
                      className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-green-500 hover:bg-green-500 hover:text-black"
                    >
                      <Truck className="h-4 w-4" />
                      Hire Driver
                    </Link>
                  ) : (
                    <Link
                      to={`/?seller=${profile.userId}`}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white hover:text-black"
                    >
                      <Store className="h-4 w-4" />
                      Start Trade
                    </Link>
                  )}

                  {canReportProfile && (
                    <button
                      onClick={() => setShowReportModal(true)}
                      className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500 hover:text-white"
                    >
                      <Flag className="h-4 w-4" />
                      Report
                    </button>
                  )}
                </>
              )}

              {isOwnProfile && (
                <Link
                  to="/wallet?fund=1"
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400"
                >
                  <WalletCards className="h-4 w-4" />
                  Fund Your Hema Account
                </Link>
              )}

              {isOwnProfile && founderAccount ? (
                <Link
                  to="/admin"
                  className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:bg-amber-500 hover:text-black"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Admin Dashboard
                </Link>
              ) : isOwnProfile ? (
                <button
                  onClick={() => updateRoles([])}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white hover:text-black"
                >
                  <UserCog className="h-4 w-4" />
                  Switch Roles
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Followers', value: profile.followersCount || 0, icon: Users },
              { label: 'Following', value: profile.followingCount || 0, icon: UserPlus },
              { label: 'Trades', value: totalTrades, icon: ShieldCheck },
              { label: 'Trust Score', value: `${trustScore}%`, icon: Zap }
            ].map(item => (
              <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <item.icon className="h-4 w-4 text-amber-500" />
                  <p className="text-[9px] font-black uppercase tracking-widest">
                    {item.label}
                  </p>
                </div>
                <p className="mt-2 font-serif text-2xl text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          { label: 'Rating', value: rating.toFixed(1), icon: Star },
          { label: 'Sales', value: totalSales, icon: Store },
          { label: 'Delivery', value: `${deliverySuccessRate}%`, icon: Truck },
          { label: 'Escrow', value: `${escrowSuccessRate}%`, icon: Shield },
          { label: 'Response', value: `${responseRate}%`, icon: MessageCircle },
          { label: 'Speed', value: responseTime, icon: Clock }
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-white/5 bg-brand-card p-4 shadow-xl">
            <item.icon className="mb-3 h-5 w-5 text-amber-500" />
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
              {item.label}
            </p>
            <p className="mt-1 truncate font-serif text-lg text-white">{item.value}</p>
          </div>
        ))}
      </section>

      <TrustCenterPanel
        userId={profile.userId}
        profile={{
          ...profile,
          ...(founderAccount
            ? {
                trustScore: 100,
                trustLevel: 'VERIFIED ELITE',
                averageRating: 5,
                avgDriverRating: 5,
                communityRatingPercent,
                totalTrades,
                completedTrades: totalTrades,
                successfulTrades: totalTrades,
                totalSales,
                salesCount: totalSales,
                completedDeliveries,
                deliveriesCount: completedDeliveries,
                escrowSuccessRate: 100,
                deliveryCompletionRate: 100,
                deliverySuccessRate: 100,
                responseRate: 100
              }
            : {})
        }}
        isOwnProfile={isOwnProfile}
      />

      <VerificationCenterPanel
        userId={profile.userId}
        profile={profile}
        isOwnProfile={isOwnProfile}
      />

      <section className="overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="scrollbar-hide flex gap-2 overflow-x-auto border-b border-white/5 p-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-black'
                  : 'text-slate-500 hover:bg-white/5 hover:text-white'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-8">
          {activeTab === 'listings' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.length > 0 ? (
                listings.map(item => (
                  <Link
                    key={item.id}
                    to={`/listing/${item.id}`}
                    className="group overflow-hidden rounded-2xl border border-white/5 bg-black/30"
                  >
                    <div className="aspect-[4/3] bg-slate-900">
                      {item.images?.[0] ? (
                        <img
                          src={item.images[0]}
                          alt={item.title || 'Listing'}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-700">
                          <Package className="h-10 w-10" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="truncate font-serif text-lg text-white">
                          {item.title || 'Untitled listing'}
                        </h3>
                        <span className="text-[10px] font-black text-amber-500">
                          ${(item.price || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-green-500/10 px-2 py-1 text-[8px] font-black uppercase text-green-500">
                          Escrow protected
                        </span>
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase text-amber-500">
                          Local trader
                        </span>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-black uppercase text-slate-400">
                          Delivery available
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="col-span-full rounded-2xl border border-white/5 bg-black/30 p-10 text-center text-slate-500">
                  No listings published yet.
                </div>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <ProfileReviewsTab
              targetUserId={profile.userId}
              profile={profile}
              authUser={authUser}
              isOwnProfile={isOwnProfile}
            />
          )}

          {activeTab === 'about' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                { label: 'Bio', value: profile.bio || 'No bio added yet.', icon: FileText },
                { label: 'Trader Story', value: profile.businessDescription || (founderAccount ? 'Founder of Hema Trader.' : 'No trader story added.'), icon: BriefcaseBusiness },
                { label: 'Trade Category', value: profile.businessCategory || 'Agricultural marketplace trader', icon: Store },
                { label: 'Location', value: profile.location || profile.city || 'Cameroon', icon: MapPin },
                { label: 'Languages', value: profile.languages?.join(', ') || 'Not specified', icon: Languages },
                { label: 'Phone', value: isOwnProfile ? profile.phoneNumber || 'Not added' : profile.showPhone ? profile.phoneNumber : 'Private', icon: Phone },
                { label: 'Email', value: isOwnProfile ? profile.email || 'Not added' : 'Private', icon: Mail },
                { label: 'Website', value: profile.website || 'Not added', icon: Globe2 }
              ].map(item => (
                <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <div className="flex items-center gap-3">
                    <item.icon className="h-5 w-5 text-amber-500" />
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-3 font-serif text-sm leading-relaxed text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'deliveries' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                { label: 'Completed Deliveries', value: completedDeliveries },
                { label: 'Current Deliveries', value: founderAccount ? 0 : profile.currentDeliveries || 0 },
                { label: 'Success Rate', value: `${deliverySuccessRate}%` },
                { label: 'Vehicle Type', value: profile.vehicleType || 'Not specified' },
                { label: 'Delivery Zones', value: profile.deliveryZones?.join(', ') || 'Not specified' },
                { label: 'Availability', value: founderAccount ? 'Available' : profile.driverStatus || 'Offline' }
              ].map(item => (
                <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                  <Truck className="mb-3 h-5 w-5 text-green-500" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-2 font-serif text-xl text-white">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-4">
              {activities.length > 0 ? (
                activities.map(item => (
                  <div key={item.id} className="flex items-start gap-4 rounded-2xl border border-white/5 bg-black/30 p-5">
                    <div className="rounded-xl bg-amber-500/10 p-3 text-amber-500">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-serif text-lg text-white">{item.title || 'Profile activity'}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.body || 'New activity inside Hema Trader.'}</p>
                      <p className="mt-3 text-[8px] font-black uppercase tracking-widest text-slate-600">
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/5 bg-black/30 p-10 text-center text-slate-500">
                  No public activity yet.
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {isOwnProfile && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <UserCog className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Profile Settings</h3>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={settingsLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-amber-500 disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              Upload Avatar
            </button>

            <button
              onClick={() => bannerInputRef.current?.click()}
              disabled={settingsLoading}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 py-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white hover:text-black disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Upload Banner
            </button>
          </div>

          <input
            ref={avatarInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={event =>
              event.target.files?.[0] && handleAvatarUpload(event.target.files[0])
            }
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <input value={displayNameInput} onChange={event => setDisplayNameInput(event.target.value)} placeholder={profile.displayName || 'Display name'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <button onClick={handleDisplayNameUpdate} disabled={!displayNameInput.trim() || settingsLoading} className="rounded-xl bg-white/10 py-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/20 disabled:opacity-40">
              Save Name
            </button>
            <input value={usernameInput} onChange={event => setUsernameInput(event.target.value)} placeholder={profile.username || 'Username'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <input value={bioInput} onChange={event => setBioInput(event.target.value)} placeholder={profile.bio || 'Bio'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <input value={locationInput} onChange={event => setLocationInput(event.target.value)} placeholder={profile.location || 'Location'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <input value={phoneInput} onChange={event => setPhoneInput(event.target.value)} placeholder={profile.phoneNumber || 'Phone'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <input value={tradeCategoryInput} onChange={event => setTradeCategoryInput(event.target.value)} placeholder={profile.businessCategory || 'Trade category, crops, livestock, delivery'} className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <input value={languagesInput} onChange={event => setLanguagesInput(event.target.value)} placeholder="Languages, comma separated" className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none" />
            <textarea value={tradeDescriptionInput} onChange={event => setTradeDescriptionInput(event.target.value)} placeholder={profile.businessDescription || 'Tell buyers what you sell, grow, raise, or deliver'} className="min-h-28 rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none md:col-span-2" />
          </div>

          <button
            onClick={handlePremiumSettingsUpdate}
            disabled={settingsLoading}
            className="w-full rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
          >
            Save Profile Details
          </button>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <KeyRound className="h-3 w-3" />
              Change Password
            </label>

            {passwordProviderEnabled ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={passwordInput}
                  onChange={event => setPasswordInput(event.target.value)}
                  type="password"
                  placeholder="New password"
                  className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={handlePasswordUpdate}
                  disabled={passwordInput.length < 6 || settingsLoading}
                  className="rounded-xl bg-white/10 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white/20 disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            ) : (
              <p className="rounded-xl border border-white/5 bg-black/40 p-4 text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
                Your password is managed by your Google account.
              </p>
            )}
          </div>

          {settingsMessage && (
            <p className="rounded-xl border border-white/5 bg-black/40 p-4 text-center text-[10px] font-bold uppercase tracking-widest text-amber-500">
              {settingsMessage}
            </p>
          )}
        </section>
      )}

      {isOwnProfile && roles.includes('driver') && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Driver Settings</h3>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <select
              value={profile.vehicleType || 'motorbike'}
              onChange={event =>
                updateDoc(doc(db, 'users', profile.userId), {
                  vehicleType: event.target.value,
                  updatedAt: serverTimestamp()
                })
              }
              className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="motorbike">Motorbike / Scooter</option>
              <option value="car">Personal Car</option>
              <option value="van">Delivery Van</option>
              <option value="truck">Lorry / Truck</option>
            </select>

            <select
              value={profile.driverStatus || 'available'}
              onChange={event =>
                updateDoc(doc(db, 'users', profile.userId), {
                  driverStatus: event.target.value,
                  updatedAt: serverTimestamp()
                })
              }
              className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="available">Available for delivery</option>
              <option value="on_trip">Busy on a trip</option>
              <option value="offline">Offline</option>
            </select>
          </div>
        </section>
      )}

      {isOwnProfile && (
        <>
          <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
            <div className="flex items-center gap-3 text-slate-400">
              <FileText className="h-6 w-6" />
              <h3 className="font-serif text-xl">Legal & Support</h3>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <a href="/privacy" className="group flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4 text-left hover:border-amber-500/30">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Privacy Policy</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">How we handle your data</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-amber-500" />
              </a>

              <a href="/terms" className="group flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4 text-left hover:border-amber-500/30">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Terms of Service</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">Platform rules and escrow</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-amber-500" />
              </a>
            </div>
          </section>

          <button
            onClick={logout}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/5 bg-brand-card py-5 font-bold uppercase tracking-widest text-slate-500 shadow-2xl hover:border-red-500/30 hover:bg-red-950/20 hover:text-red-500"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </>
      )}

      <AnimatePresence>
        {showReportModal && canReportProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-lg space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl"
            >
              <div className="space-y-3 text-center">
                <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
                <h2 className="font-serif text-3xl text-white">Report User</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Help keep Hema Trader safe and trusted
                </p>
              </div>

              <div className="space-y-4">
                <select
                  value={reportReason}
                  onChange={event => setReportReason(event.target.value)}
                  className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
                >
                  <option value="">Select a reason...</option>
                  <option value="fraud">Fraud</option>
                  <option value="fake_products">Fake products</option>
                  <option value="abuse">Abuse</option>
                  <option value="scam">Scam</option>
                  <option value="harassment">Harassment</option>
                </select>

                <textarea
                  value={reportDescription}
                  onChange={event => setReportDescription(event.target.value)}
                  placeholder="Tell us more..."
                  className="h-32 w-full resize-none rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReport}
                  disabled={!reportReason}
                  className="flex-1 rounded-xl bg-red-500 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl disabled:opacity-50"
                >
                  Submit Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
