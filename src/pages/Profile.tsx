import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../components/auth/AuthContext';
import { doc, getDoc, updateDoc, serverTimestamp, setDoc, deleteDoc, increment, collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNotifications } from '../components/notifications/NotificationContext';
import { Shield, Camera, FileText, CheckCircle, AlertCircle, LogOut, Loader2, UserPlus, UserMinus, ShieldCheck, ShieldAlert, MapPin, Star, Truck, AlertTriangle, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Profile() {
  const { userId: urlUserId } = useParams();
  const { user: authUser, profile: myProfile, logout, updateLocation, updateRoles, loading: authLoading } = useAuth();
  const { sendNotification } = useNotifications();
  
  const targetUserId = urlUserId || authUser?.uid;
  const isOwnProfile = !urlUserId || urlUserId === authUser?.uid;

  const [targetProfile, setTargetProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  const handleReport = async () => {
    if (!authUser || !targetUserId) return;
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
  const [followingLoading, setFollowingLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [success, setSuccess] = useState(false);

  const idInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

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
          setTargetProfile({ userId: docSnap.id, ...docSnap.data() });
        }
      } catch (err) {
        console.error("Profile fetch fail", err);
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

  const toggleFollow = async () => {
    if (!authUser || !targetUserId || isOwnProfile || !targetProfile) return;
    setFollowingLoading(true);
    const followId = `${authUser.uid}_${targetUserId}`;
    const followRef = doc(db, 'follows', followId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        await updateDoc(doc(db, 'users', authUser.uid), { followingCount: increment(-1) });
        await updateDoc(doc(db, 'users', targetUserId), { followersCount: increment(-1) });
        setIsFollowing(false);
        setTargetProfile((prev: any) => ({ ...prev, followersCount: (prev.followersCount || 1) - 1 }));
      } else {
        await setDoc(followRef, {
          followerId: authUser.uid,
          followingId: targetUserId,
          createdAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'users', authUser.uid), { followingCount: increment(1) });
        await updateDoc(doc(db, 'users', targetUserId), { followersCount: increment(1) });
        setIsFollowing(true);
        setTargetProfile((prev: any) => ({ ...prev, followersCount: (prev.followersCount || 0) + 1 }));

        sendNotification(targetUserId, {
          title: 'New Follower',
          body: `${myProfile?.displayName || 'Someone'} started following you.`,
          type: 'system',
          targetId: authUser.uid
        });
      }
    } catch (err) {
      console.error("Follow error:", err);
    } finally {
      setFollowingLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-6">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 animate-pulse">Synchronizing profile...</p>
      </div>
    );
  }

  const profile = isOwnProfile ? myProfile : targetProfile;

  if (!profile) {
    return (
      <div className="mx-auto max-w-md py-32 text-center p-8 bg-brand-card rounded-[3rem] border border-white/5">
        <ShieldAlert className="h-16 w-16 text-red-500/20 mx-auto mb-6" />
        <h2 className="font-serif text-2xl text-white mb-2">{isOwnProfile ? 'Please sign in again' : 'User not found'}</h2>
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider leading-relaxed">
          {isOwnProfile ? "We couldn't verify your session. Please try logging back in." : "The user you are looking for does not exist or has been removed."}
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

  const handleUpload = async (type: 'idFrontUrl' | 'selfieUrl', file: File) => {
    if (!profile) return;
    setUploading(true);
    setSuccess(false);

    const storageRef = ref(storage, `verifications/${profile.userId}/${type}_${Date.now()}`);
    
    try {
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      const userDocRef = doc(db, 'users', profile.userId);
      await updateDoc(userDocRef, {
        [type]: downloadURL,
        verificationStatus: 'pending',
        updatedAt: serverTimestamp(),
      });
      
      setSuccess(true);
    } catch (error) {
      console.error('Upload error', error);
      alert('Failed to upload. Rules might be blocking or network error.');
    } finally {
      setUploading(false);
    }
  };

  const statusColors = {
    unverified: 'bg-zinc-100 text-zinc-600',
    pending: 'bg-amber-100 text-amber-700',
    verified: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <div className="mx-auto max-w-xl space-y-10">
      {/* Header */}
      <section className="text-center">
        <div className="mx-auto h-32 w-32 overflow-hidden rounded-full border-4 border-[#2A2A2E] shadow-2xl relative">
          <img 
            src={profile?.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hema'} 
            alt="Profile" 
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
        <h2 className="mt-6 text-3xl font-serif text-white tracking-tight">{profile?.displayName}</h2>
        <p className="text-xs uppercase tracking-widest text-slate-500 mt-1">{profile?.email}</p>
        
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {profile?.badges?.map((badge: string) => (
            <div key={badge} className="px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-sm">
              {badge}
            </div>
          ))}
          {profile?.roles?.map((role: string) => (
            <div key={role} className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] border shadow-sm ${
              role === 'admin' 
                ? 'bg-red-500/10 text-red-500 border-red-500/20' 
                : role === 'seller'
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                : 'bg-blue-500/10 text-blue-500 border-blue-500/20'
            }`}>
              {role}
            </div>
          ))}
        </div>

        {isOwnProfile && (
          <button 
            onClick={() => updateRoles([])} // Empty roles triggers RoleSelection gate
            className="mt-4 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-amber-500 transition-colors"
          >
            Change Marketplace Roles
          </button>
        )}

        {!isOwnProfile && authUser && (
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => setShowReportModal(true)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 border border-white/10 text-slate-500 hover:bg-red-500/10 hover:text-red-500 transition-all shadow-xl"
              title="Report User"
            >
              <AlertTriangle className="h-5 w-5" />
            </button>
            <button
              onClick={toggleFollow}
              disabled={followingLoading}
              className={`flex items-center gap-2 rounded-full px-8 py-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-xl ${
                isFollowing 
                  ? 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10' 
                  : 'bg-white text-black hover:bg-amber-500'
              }`}
            >
              {followingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isFollowing ? (
                <>
                  <UserMinus className="h-4 w-4" />
                  Unfollow Seller
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Follow Seller
                </>
              )}
            </button>
          </div>
        )}

        {isOwnProfile && (profile.totalTrades || 0) === 0 && (
          <section className="rounded-[2.5rem] bg-gradient-to-r from-amber-500 to-amber-600 p-10 shadow-2xl space-y-4">
            <h3 className="font-serif text-3xl text-black">Start Your Legacy</h3>
            <p className="text-[10px] font-black uppercase tracking-widest text-black/60 leading-relaxed">You haven't completed any trades yet. Sellers who complete their first trade in 48 hours are 4x more likely to become Elite Vendors.</p>
            <button className="px-8 py-3 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-900 transition-all">Create Your First Listing</button>
          </section>
        )}
      </section>

      {/* Public Driver Stats */}
      {!isOwnProfile && profile?.roles?.includes('driver') && (
        <section className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="h-6 w-6 text-amber-500" />
              <h3 className="font-serif text-xl text-white">Delivery Partner</h3>
            </div>
            <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
              profile.driverStatus === 'available' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
            }`}>
              {profile.driverStatus || 'Offline'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-2xl bg-black/40 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">Rating</p>
              <div className="flex items-center justify-center gap-1">
                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                <p className="text-lg font-serif text-white">{profile.avgDriverRating?.toFixed(1) || '0.0'}</p>
              </div>
            </div>
            <div className="text-center p-4 rounded-2xl bg-black/40 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">Vehicle</p>
              <p className="text-xs font-black uppercase tracking-widest text-white">{profile.vehicleType || 'Motorbike'}</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-black/40 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">Trips</p>
              <p className="text-lg font-serif text-white">{profile.deliveriesCount || 0}</p>
            </div>
          </div>
        </section>
      )}

      {/* Driver Settings */}
      {isOwnProfile && profile?.roles?.includes('driver') && (
        <section className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Driver Settings</h3>
          </div>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Vehicle Type</label>
              <select 
                value={profile.vehicleType || 'motorbike'}
                onChange={(e) => updateDoc(doc(db, 'users', profile.userId), { vehicleType: e.target.value })}
                className="w-full rounded-xl bg-black/40 border border-white/5 px-5 py-4 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="motorbike">Motorbike / Scooter</option>
                <option value="car">Personal Car</option>
                <option value="van">Delivery Van</option>
                <option value="truck">Lorry / Truck</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Availability</label>
              <select 
                value={profile.driverStatus || 'available'}
                onChange={(e) => updateDoc(doc(db, 'users', profile.userId), { driverStatus: e.target.value })}
                className="w-full rounded-xl bg-black/40 border border-white/5 px-5 py-4 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option value="available">Available for delivery</option>
                <option value="on_trip">Busy (On a trip)</option>
                <option value="offline">Offline / Off-duty</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {/* Trade Metrics & Geographic Anchoring */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3">
            <Star className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">Trust & Activity</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center space-y-1">
              <p className="text-[8px] font-bold tracking-wider text-slate-600 uppercase">Seller Rating</p>
              <p className="font-serif text-xl text-amber-500">{profile?.averageRating?.toFixed(1) || '0.0'}</p>
            </div>
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center space-y-1">
              <p className="text-[8px] font-bold tracking-wider text-slate-600 uppercase">Total Trades</p>
              <p className="font-serif text-xl text-white">{profile?.totalTrades || 0}</p>
            </div>
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center space-y-1">
              <p className="text-[8px] font-bold tracking-wider text-slate-600 uppercase">Followers</p>
              <p className="font-serif text-xl text-amber-500/80">{profile?.followersCount || 0}</p>
            </div>
            <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center space-y-1">
              <p className="text-[8px] font-bold tracking-wider text-slate-600 uppercase">Following</p>
              <p className="font-serif text-xl text-white/80">{profile?.followingCount || 0}</p>
            </div>
          </div>
          {profile?.badge && (
            <div className="flex items-center justify-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500">{profile.badge}</span>
            </div>
          )}
        </div>

        <div className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6 text-amber-500" />
            <h3 className="font-serif text-xl text-white">{isOwnProfile ? 'My Location' : 'Seller Location'}</h3>
          </div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-relaxed">
            {isOwnProfile ? 'Set your location to see trades and listings near you.' : 'Approximate location of this seller.'}
          </p>
          {profile?.latitude ? (
            <div className="flex items-center justify-between p-5 rounded-2xl bg-black/40 border border-white/5">
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-wider text-slate-600 uppercase">Coordinates</p>
                <p className="font-mono text-xs text-amber-500">
                  {profile.latitude.toFixed(4)}°N, {profile.longitude.toFixed(4)}°E
                </p>
              </div>
              {isOwnProfile && (
                <button 
                  onClick={handleLocationUpdate}
                  disabled={locating}
                  className="px-4 py-2 rounded-lg bg-white/5 border border-white/5 text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:border-amber-500/30"
                >
                  Update
                </button>
              )}
            </div>
          ) : isOwnProfile ? (
            <button 
              onClick={handleLocationUpdate}
              disabled={locating}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 font-bold uppercase tracking-wider text-black shadow-2xl hover:bg-slate-200 transition-all disabled:opacity-50"
            >
              {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
              Set Location
            </button>
          ) : (
            <p className="text-center py-4 text-[10px] font-bold uppercase tracking-widest text-slate-700 italic">Location Not Disclosed</p>
          )}
        </div>
      </section>

      {/* Verification Section */}
      {isOwnProfile && (
        <section className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-6 w-6 text-amber-500" />
          <h3 className="font-serif text-xl text-white">Identity Verification</h3>
        </div>

        {profile?.verificationStatus === 'verified' ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-amber-500" />
            <p className="font-serif text-2xl text-white">Identity Verified</p>
            <p className="text-xs uppercase tracking-widest text-slate-500">Your profile has been verified and you can trade freely.</p>
          </div>
        ) : profile?.verificationStatus === 'pending' ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }}>
              <AlertCircle className="h-16 w-16 text-amber-600/40" />
            </motion.div>
            <p className="font-serif text-2xl text-slate-300 italic">Review in Progress</p>
            <p className="text-xs uppercase tracking-widest text-slate-500 max-w-[240px] leading-relaxed mx-auto">Our team is currently reviewing your documents. This usually takes 24-48 hours.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-[11px] text-slate-400 uppercase tracking-widest text-center leading-relaxed">
              To build trust and unlock trading, please upload your identity documents.
            </p>

            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => idInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-brand-item p-6 transition-all hover:bg-white/5 hover:border-amber-500/50"
              >
                <div className="flex items-center gap-5">
                  <div className="rounded-lg bg-black/40 p-3 shadow-inner">
                    <FileText className="h-6 w-6 text-amber-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">ID Document</p>
                    <p className="text-[10px] text-slate-500 mt-1 italic font-serif">Front of Passport or ID card</p>
                  </div>
                </div>
                {profile?.idFrontUrl ? <CheckCircle className="h-6 w-6 text-amber-500" /> : <div className="h-6 w-6 rounded-full border border-white/10" />}
              </button>
              <input 
                type="file" 
                hidden 
                ref={idInputRef} 
                accept="image/*" 
                onChange={(e) => e.target.files?.[0] && handleUpload('idFrontUrl', e.target.files[0])} 
              />

              <button 
                onClick={() => selfieInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-brand-item p-6 transition-all hover:bg-white/5 hover:border-amber-500/50"
              >
                <div className="flex items-center gap-5">
                  <div className="rounded-lg bg-black/40 p-3 shadow-inner">
                    <Camera className="h-6 w-6 text-amber-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-wider text-white">Selfie Photo</p>
                    <p className="text-[10px] text-slate-500 mt-1 italic font-serif">A clear photo of your face</p>
                  </div>
                </div>
                {profile?.selfieUrl ? <CheckCircle className="h-6 w-6 text-amber-500" /> : <div className="h-6 w-6 rounded-full border border-white/10" />}
              </button>
              <input 
                type="file" 
                hidden 
                ref={selfieInputRef} 
                accept="image/*" 
                onChange={(e) => e.target.files?.[0] && handleUpload('selfieUrl', e.target.files[0])} 
              />
            </div>

            {uploading && (
              <div className="flex items-center justify-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Uploading documents...</span>
              </div>
            )}
            
            {success && <p className="text-center text-[10px] font-bold uppercase tracking-wider text-amber-500">Documents Submitted Successfully</p>}
          </div>
        )}
      </section>
    )}

      {/* Legal & About */}
      {isOwnProfile && (
        <section className="rounded-[2.5rem] bg-brand-card p-8 shadow-2xl border border-white/5 space-y-6">
          <div className="flex items-center gap-3 text-slate-400">
            <FileText className="h-6 w-6" />
            <h3 className="font-serif text-xl">Legal & Support</h3>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <a 
              href="/privacy" 
              className="group flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-amber-500/30 transition-all text-left"
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Privacy Policy</p>
                <p className="text-[9px] text-slate-500 mt-0.5">How we handle your data</p>
              </div>
              <ChevronLeft className="h-4 w-4 text-slate-600 rotate-180 group-hover:text-amber-500 transition-colors" />
            </a>
            <a 
              href="/terms" 
              className="group flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-amber-500/30 transition-all text-left"
            >
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Terms of Service</p>
                <p className="text-[9px] text-slate-500 mt-0.5">Platform rules and escrow</p>
              </div>
              <ChevronLeft className="h-4 w-4 text-slate-600 rotate-180 group-hover:text-amber-500 transition-colors" />
            </a>
          </div>
        </section>
      )}

      {/* Logout */}
      {isOwnProfile && (
        <button 
          onClick={logout}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/5 bg-brand-card py-5 font-bold uppercase tracking-widest text-slate-500 transition-all hover:bg-red-950/20 hover:text-red-500 hover:border-red-500/30 shadow-2xl"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      )}

      {/* Report Modal */}
      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-lg rounded-[2.5rem] bg-brand-card p-10 border border-white/5 shadow-2xl space-y-8"
            >
              <div className="text-center space-y-3">
                <AlertTriangle className="h-10 w-10 text-red-500 mx-auto" />
                <h2 className="font-serif text-3xl text-white">Report User</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Help keep Hema Trader safe and trusted</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Reason</label>
                  <select 
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full rounded-xl bg-black/40 border border-white/5 px-5 py-4 text-sm text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="">Select a reason...</option>
                    <option value="scam">Potential Scam / Fraud</option>
                    <option value="inappropriate">Inappropriate Content</option>
                    <option value="harassment">Harassment / Abuse</option>
                    <option value="poor_quality">Poor Quality / Misleading</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">Details</label>
                  <textarea 
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="Tell us more about what happened..."
                    className="w-full h-32 rounded-xl bg-black/40 border border-white/5 px-5 py-4 text-sm text-white focus:outline-none focus:border-red-500 resize-none"
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
