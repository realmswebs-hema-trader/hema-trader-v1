import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, limit, getDocs, setDoc, deleteDoc, increment, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { MapPin, MessageCircle, AlertCircle, Loader2, Star, ShieldCheck, Scale, ArrowRight, CreditCard, UserPlus, UserMinus } from 'lucide-react';
import { motion } from 'motion/react';
import { calculateDistance, formatDistance } from '../lib/geoUtils';

interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  location: string;
  images: string[];
  ownerId: string;
  status: string;
  quantity: string;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, string>;
  isBoosted?: boolean;
  boostTier?: string;
  boostExpiresAt?: any;
}

interface SellerProfile {
  displayName: string;
  photoURL: string;
  averageRating: number;
  totalTrades: number;
  verificationStatus: string;
  lastActiveAt?: any;
  followersCount?: number;
  followingCount?: number;
}

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();
  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [nearby, setNearby] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trading, setTrading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);

  useEffect(() => {
    if (!user || !listing) return;

    const checkFollow = async () => {
      const followId = `${user.uid}_${listing.ownerId}`;
      const followRef = doc(db, 'follows', followId);
      const followSnap = await getDoc(followRef);
      setIsFollowing(followSnap.exists());
    };

    checkFollow();
  }, [user, listing]);

  const toggleFollow = async () => {
    if (!user || !listing || !seller) return;
    setFollowingLoading(true);
    const followId = `${user.uid}_${listing.ownerId}`;
    const followRef = doc(db, 'follows', followId);

    try {
      if (isFollowing) {
        await deleteDoc(followRef);
        
        // Update counts
        await updateDoc(doc(db, 'users', user.uid), { followingCount: increment(-1) });
        await updateDoc(doc(db, 'users', listing.ownerId), { followersCount: increment(-1) });
        
        setIsFollowing(false);
        setSeller(prev => prev ? { ...prev, followersCount: (prev.followersCount || 1) - 1 } : null);
      } else {
        await setDoc(followRef, {
          followerId: user.uid,
          followingId: listing.ownerId,
          createdAt: serverTimestamp()
        });

        // Update counts
        await updateDoc(doc(db, 'users', user.uid), { followingCount: increment(1) });
        await updateDoc(doc(db, 'users', listing.ownerId), { followersCount: increment(1) });

        setIsFollowing(true);
        setSeller(prev => prev ? { ...prev, followersCount: (prev.followersCount || 0) + 1 } : null);

        // Notify Seller
        sendNotification(listing.ownerId, {
          title: 'New Follower',
          body: `${profile?.displayName || 'Someone'} started following you.`,
          type: 'system',
          targetId: user.uid
        });
      }
    } catch (err) {
      console.error("Follow error:", err);
    } finally {
      setFollowingLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    async function fetchListing() {
      if (!id) return;
      console.log('Fetching listing:', id);
      try {
        setLoading(true);
        setError(null);
        
        const docRef = doc(db, 'listings', id);
        const docSnap = await getDoc(docRef);
        
        if (!isMounted) return;

        if (docSnap.exists()) {
          const lData = { id: docSnap.id, ...docSnap.data() } as Listing;
          setListing(lData);

          // Fetch Seller Info
          const sellerSnap = await getDoc(doc(db, 'users', lData.ownerId));
          if (isMounted && sellerSnap.exists()) {
            setSeller(sellerSnap.data() as SellerProfile);
          }

          // Fetch Nearby (same category)
          const qNearby = query(
            collection(db, 'listings'),
            where('category', '==', lData.category),
            where('status', '==', 'active'),
            limit(5)
          );
          const nearbySnap = await getDocs(qNearby);
          if (isMounted) {
            setNearby(nearbySnap.docs.filter(d => d.id !== id).map(d => ({ id: d.id, ...d.data() } as Listing)).slice(0, 4));
          }
        } else {
          setError('We couldn’t find this item in our marketplace.');
        }
      } catch (err: any) {
        console.error('Fetch Listing Error:', err);
        setError('There was a problem loading the details for this item.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    fetchListing();
    return () => { isMounted = false; };
  }, [id]);

  const startTrade = async () => {
    if (!user || !profile || !listing) return;
    if (profile.verificationStatus !== 'verified') {
      alert('Please complete your identity verification to start trading. It helps keep the marketplace safe.');
      navigate('/profile');
      return;
    }
    if (user.uid === listing.ownerId) {
      alert('You cannot trade with yourself.');
      return;
    }

    setTrading(true);
    try {
      const tradeData = {
        listingId: listing.id,
        buyerId: user.uid,
        sellerId: listing.ownerId,
        amount: listing.price,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      
      const docRef = await addDoc(collection(db, 'trades'), tradeData);
      
      // Send Welcome Message
      await addDoc(collection(db, 'trades', docRef.id, 'messages'), {
        senderId: 'system',
        text: `Trade initiated for ${listing.title}. You can now discuss terms and delivery with the other party.`,
        createdAt: serverTimestamp()
      });

      navigate(`/trade/${docRef.id}`);
    } catch (err: any) {
      console.error('Start Trade Error:', err);
      alert('Failed to initiate trade registry: ' + err.message);
    } finally {
      setTrading(false);
    }
  };

  const handleBoostListing = async (tier: string, amount: number) => {
    if (!user || !listing) return;
    const confirmBoost = window.confirm(`Confirm payment of ${amount.toLocaleString()} CFA for ${tier} boost? (Demo logic)`);
    if (!confirmBoost) return;

    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (tier === 'premium' ? 30 : 7));

      await updateDoc(doc(db, 'listings', listing.id), {
        isBoosted: true,
        boostTier: tier,
        boostExpiresAt: expiresAt
      });

      await addDoc(collection(db, 'boosts'), {
        listingId: listing.id,
        userId: user.uid,
        amount,
        tier,
        createdAt: serverTimestamp(),
        expiresAt
      });

      setListing(prev => prev ? { ...prev, isBoosted: true, boostTier: tier, boostExpiresAt: expiresAt } : null);
      alert('Listing boosted successfully! It will now appear with priority in search results.');
    } catch (err) {
      console.error('Boost error:', err);
      alert('Failed to process boost registry.');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-12 pb-20 animate-pulse">
        <div className="aspect-[2/1] rounded-[3rem] bg-white/5" />
        <div className="h-40 rounded-[3rem] bg-white/5" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="mx-auto max-w-2xl py-32 text-center">
        <div className="mb-8 flex justify-center">
          <AlertCircle className="h-16 w-16 text-amber-500/40" />
        </div>
        <h2 className="font-serif text-3xl text-white mb-4">Mismatched Details</h2>
        <p className="text-slate-500 font-serif italic mb-8">{error || 'This item is no longer available or was moved.'}</p>
        <Link to="/" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-8 py-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors">
          Return to Marketplace
        </Link>
      </div>
    );
  }

  const distance = profile?.latitude && listing.latitude 
    ? calculateDistance(profile.latitude, profile.longitude, listing.latitude, listing.longitude)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-12 pb-20">
      <div className="overflow-hidden rounded-[3rem] bg-brand-card shadow-2xl border border-white/5">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* Images */}
          <div className="aspect-square bg-slate-900 border-r border-white/5">
            {listing.images?.[0] ? (
              <img src={listing.images[0]} alt={listing.title} className="h-full w-full object-cover grayscale-[0.2] transition-all duration-1000 hover:grayscale-0" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-800">NO VISUAL DATA</div>
            )}
          </div>

          <div className="flex flex-col p-8 md:p-14">
            {listing.isBoosted && (
              <div className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/30 w-max shadow-lg shadow-amber-500/5">
                <Star className="h-4 w-4 text-amber-500 fill-amber-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">{listing.boostTier} Priority Listing</span>
              </div>
            )}
            <div className="mb-8 flex items-center justify-between">
              <div className="flex gap-2">
                <span className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">{listing.category}</span>
                {seller && seller.totalTrades >= 5 && (
                  <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-green-500">
                    <ShieldCheck className="h-3 w-3" />
                    Community Choice
                  </div>
                )}
              </div>
              <div className={`rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-widest ${listing.status === 'active' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                Status: {listing.status === 'active' ? 'Available' : 'Sold Out'}
              </div>
            </div>
            
            <h1 className="text-5xl font-serif text-white tracking-tighter leading-tight">{listing.title}</h1>
            
            <div className="mt-8 flex items-end justify-between border-b border-white/5 pb-8">
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Price</p>
                <p className="text-5xl font-bold text-amber-500 tracking-tighter">${listing.price.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Availability</p>
                <p className="font-serif text-2xl text-white italic">{listing.quantity}</p>
              </div>
            </div>
            
            <div className="mt-8 flex items-center gap-6">
              <div className="flex items-center gap-2 text-slate-400 text-[10px] uppercase tracking-widest font-black">
                <MapPin className="h-4 w-4 text-amber-500/50" />
                <span>{listing.location}</span>
                {distance !== null && (
                  <span className="text-amber-500/60 ml-2 border-l border-white/10 pl-4">{formatDistance(distance)} RADIUS</span>
                )}
              </div>
            </div>

            {/* Dynamic Metadata */}
            {listing.metadata && Object.keys(listing.metadata).length > 0 && (
              <div className="mt-8 grid grid-cols-2 gap-4">
                {Object.entries(listing.metadata).map(([key, val]) => (
                  <div key={key} className="rounded-xl bg-black/20 p-4 border border-white/5">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 mb-1">{key}</p>
                    <p className="text-sm font-serif text-white">{val}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-12 flex-1">
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-bold mb-4 flex items-center gap-2">
                <Scale className="h-3 w-3" />
                Product Description
              </h3>
              <p className="text-slate-400 leading-relaxed text-sm whitespace-pre-wrap font-serif italic border-l-2 border-amber-500/10 pl-6">"{listing.description}"</p>
            </div>

            <div className="mt-12 group rounded-3xl bg-black/40 p-6 border border-white/5 transition-all hover:border-amber-500/20">
              <div className="flex items-center gap-5">
                <div className="relative">
                  <img 
                    src={seller?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${listing.ownerId}`} 
                    className="h-14 w-14 rounded-full border-2 border-white/10 grayscale-[0.3] group-hover:grayscale-0 transition-all" 
                    alt=""
                  />
                  {seller?.lastActiveAt && (Date.now() - seller.lastActiveAt.toMillis() < 1000 * 60 * 15) && (
                    <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-brand-card shadow-lg" />
                  )}
                </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="font-serif text-lg text-white">{seller?.displayName || 'Marketplace Seller'}</p>
                        {seller?.verificationStatus === 'verified' && (
                          <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 border border-amber-500/20">
                            <ShieldCheck className="h-3 w-3 text-amber-500" />
                            <span className="text-[8px] font-bold uppercase tracking-wider text-amber-500">Verified Seller</span>
                          </div>
                        )}
                      </div>
                      
                      {user && user.uid !== listing.ownerId && (
                        <button
                          onClick={(e) => { e.preventDefault(); toggleFollow(); }}
                          disabled={followingLoading}
                          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[8px] font-black uppercase tracking-widest transition-all ${
                            isFollowing 
                              ? 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10' 
                              : 'bg-white text-black hover:bg-amber-500'
                          }`}
                        >
                          {followingLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : isFollowing ? (
                            <><UserMinus className="h-3 w-3" /> Unfollow</>
                          ) : (
                            <><UserPlus className="h-3 w-3" /> Follow</>
                          )}
                        </button>
                      )}
                    </div>
                     <div className="flex items-center gap-3 mt-1">
                       <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{seller?.totalTrades || 0} Trades</p>
                       <div className="h-1 w-1 rounded-full bg-slate-800" />
                       <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{seller?.followersCount || 0} Followers</p>
                       <div className="h-1 w-1 rounded-full bg-slate-800" />
                       <p className="text-[9px] font-bold uppercase tracking-widest text-green-500/80">Typically responds in ~2h</p>
                     </div>
                 </div>
                 <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                      <div className="flex items-center gap-1 text-amber-500">
                        <Star className="h-3 w-3 fill-amber-500" />
                        {seller?.averageRating?.toFixed(1) || '0.0'}
                      </div>
                      <span className="text-slate-600">• {seller?.totalTrades || 0} Successful Trades</span>
                    </div>
                    {seller?.lastActiveAt && (
                      <span className="text-[9px] font-mono text-slate-500 italic">Usually responds within 1 hour</span>
                    )}
                  </div>
                </div>
              </div>

               {listing.ownerId === user?.uid && (
                <div className="mt-12 rounded-3xl bg-amber-500/10 p-8 border border-amber-500/20 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-500 text-black">
                      <Scale className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-serif text-2xl text-white">Boost Visibility</h3>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500">Reach up to 10x more traders in your region</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                      onClick={() => handleBoostListing('standard', 2000)}
                      className="p-5 rounded-2xl bg-black/40 border border-white/5 text-left group hover:border-amber-500/50 transition-all"
                    >
                      <h4 className="font-serif text-lg text-white group-hover:text-amber-500">Standard Boost</h4>
                      <p className="text-[9px] uppercase tracking-widest text-slate-500 mt-1">7 Days Priority Placement</p>
                      <p className="text-xl font-bold text-white mt-4 tracking-tighter">2,000 CFA</p>
                    </button>
                    <button
                      onClick={() => handleBoostListing('premium', 5000)}
                      className="p-5 rounded-2xl bg-black/40 border border-white/5 text-left group hover:border-amber-500/50 transition-all border-l-4 border-l-amber-500"
                    >
                      <h4 className="font-serif text-lg text-white group-hover:text-amber-500">Premium Boost</h4>
                      <p className="text-[9px] uppercase tracking-widest text-slate-500 mt-1">30 Days Top Placement & Badging</p>
                      <p className="text-xl font-bold text-white mt-4 tracking-tighter">5,000 CFA</p>
                    </button>
                  </div>
                  
                  <p className="text-[8px] text-slate-600 uppercase tracking-widest text-center italic">Boosted listings appear at the top of category searches and the home feed.</p>
                </div>
              )}

              <div className="mt-8">
              {profile?.verificationStatus === 'verified' ? (
                listing.status === 'active' ? (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <button
                        onClick={startTrade}
                        disabled={trading || listing.ownerId === user?.uid}
                        className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-6 text-[11px] font-bold uppercase tracking-widest text-black transition-all hover:bg-amber-500 shadow-2xl active:scale-[0.98] disabled:opacity-50"
                      >
                        {trading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><CreditCard className="h-5 w-5" /> {listing.ownerId === user?.uid ? 'Editing your listing' : 'Start Secure Trade'}</>}
                      </button>
                      
                      {listing.ownerId !== user?.uid && (
                        <button
                          onClick={startTrade}
                          className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-brand-card py-6 text-[11px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/5 active:scale-[0.98]"
                        >
                          <MessageCircle className="h-5 w-5" /> Ask Seller
                        </button>
                      )}
                    </div>
                    
                    {listing.ownerId !== user?.uid && (
                      <div className="flex flex-col items-center gap-3 pt-4 border-t border-white/5">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                          <ShieldCheck className="h-3 w-3 text-green-500" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-green-500">Escrow Protected Listing</span>
                        </div>
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest text-center italic">Funds are released only when you confirm receipt.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex w-full items-center justify-center gap-4 rounded-2xl bg-white/5 py-6 text-[11px] font-bold uppercase tracking-widest text-slate-600 border border-white/5 cursor-not-allowed">
                    Sold Out
                  </div>
                )
              ) : (
                <div className="flex items-start gap-4 rounded-2xl border border-amber-600/20 bg-amber-500/5 p-6 text-[10px] text-slate-400">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
                  <p className="uppercase tracking-widest leading-loose">Identity verification required to start a trade. Please complete your profile verification first.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {nearby.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-4">
            <h2 className="font-serif text-2xl text-white">Similar Listings Nearby</h2>
            <Link to="/" className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 px-2">
            {nearby.map((l) => (
              <Link key={l.id} to={`/listing/${l.id}`} className="group space-y-3">
                <div className="aspect-square overflow-hidden rounded-3xl bg-slate-900 border border-white/5">
                  {l.images?.[0] && <img src={l.images[0]} className="h-full w-full object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all group-hover:scale-105" alt="" />}
                </div>
                <div className="px-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">${l.price.toLocaleString()}</p>
                  <h4 className="font-serif text-sm text-white truncate">{l.title}</h4>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
