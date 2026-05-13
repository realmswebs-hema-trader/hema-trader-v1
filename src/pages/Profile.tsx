import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../components/auth/AuthContext';

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

import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';

import {
  db,
  storage
} from '../lib/firebase';

import { useNotifications } from '../components/notifications/NotificationContext';

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
  ChevronLeft
} from 'lucide-react';

import {
  motion,
  AnimatePresence
} from 'motion/react';

export default function Profile() {
  const { userId: urlUserId } = useParams();

  const {
    user: authUser,
    profile: myProfile,
    logout,
    updateLocation,
    updateRoles,
    loading: authLoading
  } = useAuth();

  const { sendNotification } = useNotifications();

  const targetUserId =
    urlUserId || authUser?.uid;

  const isOwnProfile =
    !urlUserId ||
    urlUserId === authUser?.uid;

  const [targetProfile, setTargetProfile] =
    useState<any>(null);

  const [loading, setLoading] =
    useState(true);

  const [uploading, setUploading] =
    useState(false);

  const [isFollowing, setIsFollowing] =
    useState(false);

  const [showReportModal, setShowReportModal] =
    useState(false);

  const [reportReason, setReportReason] =
    useState('');

  const [
    reportDescription,
    setReportDescription
  ] = useState('');

  const [followingLoading, setFollowingLoading] =
    useState(false);

  const [locating, setLocating] =
    useState(false);

  const [success, setSuccess] =
    useState(false);

  const idInputRef =
    useRef<HTMLInputElement>(null);

  const selfieInputRef =
    useRef<HTMLInputElement>(null);

  // =====================================
  // FETCH PROFILE
  // =====================================
  useEffect(() => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      setLoading(true);

      try {
        const docRef = doc(
          db,
          'users',
          targetUserId
        );

        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setTargetProfile({
            userId: docSnap.id,
            ...docSnap.data()
          });
        }
      } catch (err) {
        console.log(
          'ℹ️ Profile sync delayed',
          err
        );
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [targetUserId]);

  // =====================================
  // FOLLOW STATUS
  // =====================================
  useEffect(() => {
    if (
      !authUser ||
      !targetUserId ||
      isOwnProfile
    )
      return;

    const checkFollow = async () => {
      try {
        const followId = `${authUser.uid}_${targetUserId}`;

        const followRef = doc(
          db,
          'follows',
          followId
        );

        const followSnap =
          await getDoc(followRef);

        setIsFollowing(
          followSnap.exists()
        );
      } catch {
        console.log(
          'ℹ️ Follow sync delayed'
        );
      }
    };

    checkFollow();
  }, [
    authUser,
    targetUserId,
    isOwnProfile
  ]);

  // =====================================
  // LOADING
  // =====================================
  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-6">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />

        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 animate-pulse">
          Synchronizing profile...
        </p>
      </div>
    );
  }

  // =====================================
  // SAFE PROFILE
  // =====================================
  const rawProfile =
    isOwnProfile
      ? myProfile
      : targetProfile;

  if (!authUser && isOwnProfile) {
    return (
      <div className="mx-auto max-w-md py-32 text-center p-8 bg-brand-card rounded-[3rem] border border-white/5">
        <ShieldAlert className="h-16 w-16 text-red-500/20 mx-auto mb-6" />

        <h2 className="font-serif text-2xl text-white mb-2">
          Please sign in again
        </h2>

        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider leading-relaxed">
          Your session expired.
        </p>
      </div>
    );
  }

  const profile = {
    userId:
      rawProfile?.userId ||
      authUser?.uid ||
      '',

    displayName:
      rawProfile?.displayName ||
      authUser?.displayName ||
      'User',

    email:
      rawProfile?.email ||
      authUser?.email ||
      '',

    photoURL:
      rawProfile?.photoURL ||
      authUser?.photoURL ||
      '',

    roles:
      rawProfile?.roles ||
      ['buyer'],

    verificationStatus:
      rawProfile?.verificationStatus ||
      'unverified',

    totalTrades:
      rawProfile?.totalTrades || 0,

    followersCount:
      rawProfile?.followersCount || 0,

    followingCount:
      rawProfile?.followingCount || 0,

    averageRating:
      rawProfile?.averageRating || 0,

    badge:
      rawProfile?.badge || null,

    latitude:
      rawProfile?.latitude,

    longitude:
      rawProfile?.longitude,

    idFrontUrl:
      rawProfile?.idFrontUrl,

    selfieUrl:
      rawProfile?.selfieUrl,

    fallback:
      rawProfile?.fallback || false
  };

  // =====================================
  // LOCATION
  // =====================================
  const handleLocationUpdate =
    async () => {
      setLocating(true);

      try {
        await updateLocation();
      } finally {
        setLocating(false);
      }
    };

  // =====================================
  // LOGOUT
  // =====================================
  const handleLogout = async () => {
    await logout();
  };

  // =====================================
  // PAGE
  // =====================================
  return (
    <div className="mx-auto max-w-xl space-y-10">

      {/* PROFILE HEADER */}
      <section className="text-center">

        <div className="mx-auto h-32 w-32 overflow-hidden rounded-full border-4 border-[#2A2A2E] shadow-2xl relative">
          <img
            src={
              profile.photoURL ||
              'https://api.dicebear.com/7.x/avataaars/svg?seed=hema'
            }
            alt="Profile"
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        <h2 className="mt-6 text-3xl font-serif text-white tracking-tight">
          {profile.displayName}
        </h2>

        <p className="text-xs uppercase tracking-widest text-slate-500 mt-1">
          {profile.email}
        </p>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {profile.roles.map(
            (role: string) => (
              <div
                key={role}
                className="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] border shadow-sm bg-amber-500/10 text-amber-500 border-amber-500/20"
              >
                {role}
              </div>
            )
          )}
        </div>

        {profile.fallback && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
              Firestore is syncing.
              Some profile data may appear later.
            </p>
          </div>
        )}
      </section>

      {/* TRUST */}
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Total Trades
          </p>

          <p className="mt-2 text-3xl font-serif text-white">
            {profile.totalTrades}
          </p>
        </div>

        <div className="rounded-[2rem] bg-brand-card p-6 border border-white/5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            Seller Rating
          </p>

          <p className="mt-2 text-3xl font-serif text-amber-500">
            {profile.averageRating}
          </p>
        </div>
      </section>

      {/* LOCATION */}
      <section className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5">

        <div className="flex items-center gap-3 mb-4">
          <MapPin className="h-5 w-5 text-amber-500" />

          <h3 className="font-serif text-xl text-white">
            My Location
          </h3>
        </div>

        {profile.latitude ? (
          <div className="space-y-3">

            <p className="text-slate-400 text-sm">
              {profile.latitude.toFixed(4)}° ,
              {profile.longitude.toFixed(4)}°
            </p>

            <button
              onClick={handleLocationUpdate}
              disabled={locating}
              className="rounded-xl bg-white px-5 py-3 text-black text-[10px] font-black uppercase tracking-widest"
            >
              {locating
                ? 'Updating...'
                : 'Update Location'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleLocationUpdate}
            disabled={locating}
            className="w-full rounded-2xl bg-white py-5 text-black text-[10px] font-black uppercase tracking-widest"
          >
            {locating
              ? 'Getting location...'
              : 'Set Location'}
          </button>
        )}
      </section>

      {/* LOGOUT */}
      {isOwnProfile && (
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/5 bg-brand-card py-5 font-bold uppercase tracking-widest text-slate-500 hover:bg-red-950/20 hover:text-red-500 hover:border-red-500/30 shadow-2xl"
        >
          <LogOut className="h-5 w-5" />

          Sign Out
        </button>
      )}
    </div>
  );
}
