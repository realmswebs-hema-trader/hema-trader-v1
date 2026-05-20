import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  setDoc,
  deleteDoc,
  increment,
  collection,
  addDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  Shield,
  Camera,
  FileText,
  CheckCircle,
  AlertCircle,
  LogOut,
  Loader2,
  UserPlus,
  UserMinus,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Star,
  Truck,
  AlertTriangle,
  ChevronLeft,
  UserCog,
  KeyRound
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { useAuth } from '../components/auth/AuthContext';
import { db, storage } from '../lib/firebase';
import { useNotifications } from '../components/notifications/NotificationContext';

export default function Profile() {
  const { userId: urlUserId } = useParams();
  const {
    user: authUser,
    profile: myProfile,
    logout,
    updateLocation,
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
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  const idInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
      const followRef = doc(db, 'follows', followId);
      const followSnap = await getDoc(followRef);

      setIsFollowing(followSnap.exists());
    };

    checkFollow();
  }, [authUser, targetUserId, isOwnProfile]);

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

  const profile = isOwnProfile ? fallbackOwnProfile : targetProfile;

  const passwordProviderEnabled =
    authUser?.providerData?.some(provider => provider.providerId === 'password') ||
    false;

  const handleReport = async () => {
    if (!authUser || !targetUserId || !reportReason) return;

    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: authUser.uid,
        targetId: targetUserId,
        reason: reportReason,
        description: reportDescription,
        status: 'pending',
        createdAt: serverTimestamp()
      });

      alert('Report submitted successfully. Our safety team will review it.');
      setShowReportModal(false);
      setReportReason('');
      setReportDescription('');
    } catch (err) {
      console.error('Report error:', err);
      alert('Failed to submit report.');
    }
  };

  const toggleFollow = async () => {
    if (!authUser || !targetUserId || isOwnProfile || !targetProfile) return;

    setFollowingLoading(true);

    const followId = `${authUser.uid}_${targetUserId}`;
    const followRef = doc(db, 'follows', followId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        await updateDoc(doc(db, 'users', authUser.uid), {
          followingCount: increment(-1)
        });
        await updateDoc(doc(db, 'users', targetUserId), {
          followersCount: increment(-1)
        });

        setIsFollowing(false);
        setTargetProfile((prev: any) => ({
          ...prev,
          followersCount: Math.max((prev.followersCount || 1) - 1, 0)
        }));
      } else {
        await setDoc(followRef, {
          followerId: authUser.uid,
          followingId: targetUserId,
          createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'users', authUser.uid), {
          followingCount: increment(1)
        });
        await updateDoc(doc(db, 'users', targetUserId), {
          followersCount: increment(1)
        });

        setIsFollowing(true);
        setTargetProfile((prev: any) => ({
          ...prev,
          followersCount: (prev.followersCount || 0) + 1
        }));

        sendNotification(targetUserId, {
          title: 'New Follower',
          body: `${myProfile?.displayName || 'Someone'} started following you.`,
          type: 'system',
          targetId: authUser.uid
        });
      }
    } catch (err) {
      console.error('Follow error:', err);
    } finally {
      setFollowingLoading(false);
    }
  };

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

  const handleLocationUpdate = async () => {
    setLocating(true);

    try {
      await updateLocation();
    } finally {
      setLocating(false);
    }
  };

  const handleUpload = async (
    type: 'idFrontUrl' | 'selfieUrl',
    file: File
  ) => {
    if (!profile) return;

    setUploading(true);
    setSuccess(false);

    const storageRef = ref(
      storage,
      `verifications/${profile.userId}/${type}_${Date.now()}`
    );

    try {
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      await updateDoc(doc(db, 'users', profile.userId), {
        [type]: downloadURL,
        verificationStatus: 'pending',
        updatedAt: serverTimestamp()
      });

      setSuccess(true);
    } catch (error) {
      console.error('Upload error', error);
      alert('Failed to upload. Rules might be blocking or network error.');
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      await updateProfilePhoto(file);
      setSettingsMessage('Profile photo updated successfully.');
    } catch (error) {
      console.error('Profile photo update failed:', error);
      setSettingsMessage('Could not update profile photo. Please try again.');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleDisplayNameUpdate = async () => {
    if (!displayNameInput.trim()) return;

    setSettingsLoading(true);
    setSettingsMessage('');

    try {
      await updateDisplayName(displayNameInput.trim());
      setDisplayNameInput('');
      setSettingsMessage('Display name updated successfully.');
    } catch (error) {
      console.error('Display name update failed:', error);
      setSettingsMessage('Could not update display name. Please try again.');
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

  return (
    <div className="mx-auto max-w-xl space-y-10">
      <section className="text-center">
        <div className="relative mx-auto h-32 w-32 overflow-hidden rounded-full border-4 border-[#2A2A2E] shadow-2xl">
          <img
            src={
              profile?.photoURL ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.userId || 'Hema'}`
            }
            alt="Profile"
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        <h2 className="mt-6 font-serif text-3xl tracking-tight text-white">
          {profile?.displayName || profile?.name || 'Hema User'}
        </h2>

        {isOwnProfile && (
          <p className="mt-1 text-xs uppercase tracking-widest text-slate-500">
            {profile?.email}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {profile?.badges?.map((badge: string) => (
            <div
              key={badge}
              className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-[0.2em] text-amber-500 shadow-sm"
            >
              {badge}
            </div>
          ))}

          {profile?.roles?.map((role: string) => (
            <div
              key={role}
              className={`rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-[0.2em] shadow-sm ${
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
            </div>
          ))}
        </div>

        {isOwnProfile && (
          <button
            onClick={() => updateRoles([])}
            className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-600 transition-colors hover:text-amber-500"
          >
            Change Marketplace Roles
          </button>
        )}

        {!isOwnProfile && authUser && (
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => setShowReportModal(true)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-500 shadow-xl transition-all hover:bg-red-500/10 hover:text-red-500"
              title="Report User"
            >
              <AlertTriangle className="h-5 w-5" />
            </button>

            <button
              onClick={toggleFollow}
              disabled={followingLoading}
              className={`flex items-center gap-2 rounded-full px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-xl transition-all ${
                isFollowing
                  ? 'border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                  : 'bg-white text-black hover:bg-amber-500'
              }`}
            >
              {followingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isFollowing ? (
                <>
                  <UserMinus className="h-4 w-4" />
                  Unfollow
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Follow
                </>
              )}
            </button>
          </div>
        )}

        {isOwnProfile && (profile.totalTrades || 0) === 0 && (
          <section className="mt-8 space-y-4 rounded-[2.5rem] bg-gradient-to-r from-amber-500 to-amber-600 p-10 shadow-2xl">
            <h3 className="font-serif text-3xl text-black">
              Start Your Legacy
            </h3>
            <p className="text-[10px] font-black uppercase leading-relaxed tracking-widest text-black/60">
              You haven't completed any trades yet. Sellers who complete their
              first trade in 48 hours are 4x more likely to become Elite Vendors.
            </p>
            <a
              href="/create-listing"
              className="inline-block rounded-xl bg-black px-8 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-slate-900"
            >
              Create Your First Listing
            </a>
          </section>
        )}
      </section>

      {isOwnProfile && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <UserCog className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Profile Settings</h3>
          </div>

          <button
            onClick={() => avatarInputRef.current?.click()}
            disabled={settingsLoading}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-amber-500 disabled:opacity-50"
          >
            {settingsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            Upload New Profile Photo
          </button>

          <input
            ref={avatarInputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={event =>
              event.target.files?.[0] && handleAvatarUpload(event.target.files[0])
            }
          />

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Change Display Name
            </label>
            <input
              value={displayNameInput}
              onChange={event => setDisplayNameInput(event.target.value)}
              placeholder={profile?.displayName || profile?.name || 'Your name'}
              className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
            <button
              onClick={handleDisplayNameUpdate}
              disabled={!displayNameInput.trim() || settingsLoading}
              className="w-full rounded-xl bg-white/10 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white/20 disabled:opacity-40"
            >
              Save Name
            </button>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <KeyRound className="h-3 w-3" />
              Change Password
            </label>

            {passwordProviderEnabled ? (
              <>
                <input
                  value={passwordInput}
                  onChange={event => setPasswordInput(event.target.value)}
                  type="password"
                  placeholder="New password"
                  className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={handlePasswordUpdate}
                  disabled={passwordInput.length < 6 || settingsLoading}
                  className="w-full rounded-xl bg-white/10 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-white/20 disabled:opacity-40"
                >
                  Update Password
                </button>
              </>
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

      {!isOwnProfile && profile?.roles?.includes('driver') && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="h-6 w-6 text-amber-500" />
              <h3 className="font-serif text-xl text-white">
                Delivery Partner
              </h3>
            </div>

            <div
              className={`rounded-full px-4 py-1.5 text-[9px] font-black uppercase tracking-widest ${
                profile.driverStatus === 'available'
                  ? 'border border-green-500/20 bg-green-500/10 text-green-500'
                  : 'border border-slate-500/20 bg-slate-500/10 text-slate-500'
              }`}
            >
              {profile.driverStatus || 'Offline'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                Rating
              </p>
              <div className="flex items-center justify-center gap-1">
                <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                <p className="font-serif text-lg text-white">
                  {profile.avgDriverRating?.toFixed(1) || '0.0'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                Vehicle
              </p>
              <p className="text-xs font-black uppercase tracking-widest text-white">
                {profile.vehicleType || 'Motorbike'}
              </p>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                Trips
              </p>
              <p className="font-serif text-lg text-white">
                {profile.deliveriesCount || 0}
              </p>
            </div>
          </div>
        </section>
      )}

      {isOwnProfile && profile?.roles?.includes('driver') && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Driver Settings</h3>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Vehicle Type
              </label>
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
            </div>

            <div className="flex flex-col gap-2">
              <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Availability
              </label>
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
                <option value="on_trip">Busy (On a trip)</option>
                <option value="offline">Offline / Off-duty</option>
              </select>
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <Star className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Trust & Activity</h3>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1 rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">
                Seller Rating
              </p>
              <p className="font-serif text-xl text-amber-500">
                {profile?.averageRating?.toFixed(1) || '0.0'}
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">
                Total Trades
              </p>
              <p className="font-serif text-xl text-white">
                {profile?.totalTrades || 0}
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">
                Followers
              </p>
              <p className="font-serif text-xl text-amber-500/80">
                {profile?.followersCount || 0}
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-black/40 p-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">
                Following
              </p>
              <p className="font-serif text-xl text-white/80">
                {profile?.followingCount || 0}
              </p>
            </div>
          </div>

          {profile?.badge && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500">
                {profile.badge}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">
              {isOwnProfile ? 'My Location' : 'Seller Location'}
            </h3>
          </div>

          <p className="text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
            {isOwnProfile
              ? 'Set your location to see trades and listings near you.'
              : 'Approximate location of this seller.'}
          </p>

          {profile?.latitude ? (
            <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-5">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Coordinates
                </p>
                <p className="font-mono text-xs text-amber-500">
                  {profile.latitude.toFixed(4)}°, {profile.longitude?.toFixed(4)}°
                </p>
              </div>

              {isOwnProfile && (
                <button
                  onClick={handleLocationUpdate}
                  disabled={locating}
                  className="rounded-lg border border-white/5 bg-white/5 px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:border-amber-500/30"
                >
                  {locating ? 'Updating...' : 'Update'}
                </button>
              )}
            </div>
          ) : isOwnProfile ? (
            <button
              onClick={handleLocationUpdate}
              disabled={locating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 font-bold uppercase tracking-wider text-black shadow-2xl transition-all hover:bg-slate-200 disabled:opacity-50"
            >
              {locating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MapPin className="h-5 w-5" />
              )}
              Set Location
            </button>
          ) : (
            <p className="py-4 text-center text-[10px] font-bold uppercase tracking-widest text-slate-700 italic">
              Location Not Disclosed
            </p>
          )}
        </div>
      </section>

      {isOwnProfile && (
        <section className="rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="mb-8 flex items-center gap-3">
            <Shield className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">
              Identity Verification
            </h3>
          </div>

          {profile?.verificationStatus === 'verified' ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12 text-center">
              <CheckCircle className="h-16 w-16 text-amber-500" />
              <p className="font-serif text-2xl text-white">
                Identity Verified
              </p>
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Your profile has been verified and you can trade freely.
              </p>
            </div>
          ) : profile?.verificationStatus === 'pending' ? (
            <div className="flex flex-col items-center justify-center space-y-4 py-12 text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
              >
                <AlertCircle className="h-16 w-16 text-amber-600/40" />
              </motion.div>
              <p className="font-serif text-2xl italic text-slate-300">
                Review in Progress
              </p>
              <p className="mx-auto max-w-[240px] text-xs uppercase leading-relaxed tracking-widest text-slate-500">
                Our team is currently reviewing your documents. This usually
                takes 24-48 hours.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-center text-[11px] uppercase leading-relaxed tracking-widest text-slate-400">
                To build trust and unlock trading, please upload your identity
                documents.
              </p>

              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={() => idInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-brand-item p-6 transition-all hover:border-amber-500/50 hover:bg-white/5"
                >
                  <div className="flex items-center gap-5">
                    <div className="rounded-lg bg-black/40 p-3 shadow-inner">
                      <FileText className="h-6 w-6 text-amber-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-wider text-white">
                        ID Document
                      </p>
                      <p className="mt-1 font-serif text-[10px] italic text-slate-500">
                        Front of Passport or ID card
                      </p>
                    </div>
                  </div>

                  {profile?.idFrontUrl ? (
                    <CheckCircle className="h-6 w-6 text-amber-500" />
                  ) : (
                    <div className="h-6 w-6 rounded-full border border-white/10" />
                  )}
                </button>

                <input
                  type="file"
                  hidden
                  ref={idInputRef}
                  accept="image/*"
                  onChange={event =>
                    event.target.files?.[0] &&
                    handleUpload('idFrontUrl', event.target.files[0])
                  }
                />

                <button
                  onClick={() => selfieInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-brand-item p-6 transition-all hover:border-amber-500/50 hover:bg-white/5"
                >
                  <div className="flex items-center gap-5">
                    <div className="rounded-lg bg-black/40 p-3 shadow-inner">
                      <Camera className="h-6 w-6 text-amber-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-wider text-white">
                        Selfie Photo
                      </p>
                      <p className="mt-1 font-serif text-[10px] italic text-slate-500">
                        A clear photo of your face
                      </p>
                    </div>
                  </div>

                  {profile?.selfieUrl ? (
                    <CheckCircle className="h-6 w-6 text-amber-500" />
                  ) : (
                    <div className="h-6 w-6 rounded-full border border-white/10" />
                  )}
                </button>

                <input
                  type="file"
                  hidden
                  ref={selfieInputRef}
                  accept="image/*"
                  onChange={event =>
                    event.target.files?.[0] &&
                    handleUpload('selfieUrl', event.target.files[0])
                  }
                />
              </div>

              {uploading && (
                <div className="flex items-center justify-center gap-3 py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Uploading documents...
                  </span>
                </div>
              )}

              {success && (
                <p className="text-center text-[10px] font-bold uppercase tracking-wider text-amber-500">
                  Documents Submitted Successfully
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {isOwnProfile && (
        <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <div className="flex items-center gap-3 text-slate-400">
            <FileText className="h-6 w-6" />
            <h3 className="font-serif text-xl">Legal & Support</h3>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <a
              href="/privacy"
              className="group flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4 text-left transition-all hover:border-amber-500/30"
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Privacy Policy
                </p>
                <p className="mt-0.5 text-[9px] text-slate-500">
                  How we handle your data
                </p>
              </div>
              <ChevronLeft className="h-4 w-4 rotate-180 text-slate-600 transition-colors group-hover:text-amber-500" />
            </a>

            <a
              href="/terms"
              className="group flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4 text-left transition-all hover:border-amber-500/30"
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                  Terms of Service
                </p>
                <p className="mt-0.5 text-[9px] text-slate-500">
                  Platform rules and escrow
                </p>
              </div>
              <ChevronLeft className="h-4 w-4 rotate-180 text-slate-600 transition-colors group-hover:text-amber-500" />
            </a>
          </div>
        </section>
      )}

      {isOwnProfile && (
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/5 bg-brand-card py-5 font-bold uppercase tracking-widest text-slate-500 shadow-2xl transition-all hover:border-red-500/30 hover:bg-red-950/20 hover:text-red-500"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      )}

      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-lg space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl"
            >
              <div className="space-y-3 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />
                <h2 className="font-serif text-3xl text-white">Report User</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Help keep Hema Trader safe and trusted
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Reason
                  </label>
                  <select
                    value={reportReason}
                    onChange={event => setReportReason(event.target.value)}
                    className="w-full rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="">Select a reason...</option>
                    <option value="scam">Potential Scam / Fraud</option>
                    <option value="inappropriate">Inappropriate Content</option>
                    <option value="harassment">Harassment / Abuse</option>
                    <option value="poor_quality">
                      Poor Quality / Misleading
                    </option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Details
                  </label>
                  <textarea
                    value={reportDescription}
                    onChange={event => setReportDescription(event.target.value)}
                    placeholder="Tell us more about what happened..."
                    className="h-32 w-full resize-none rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
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
