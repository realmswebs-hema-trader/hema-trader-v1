import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Search, MapPin, Star, ShieldCheck, ArrowRight, Filter, Compass, Loader2, CreditCard, MessageCircle, Tag, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { calculateDistance, formatDistance } from '../lib/geoUtils';
import { useAuth } from '../components/auth/AuthContext';

interface Listing {
  id: string;
  title: string;
  price: number;
  category: string;
  location: string;
  images: string[];
  ownerId: string;
  latitude?: number;
  longitude?: number;
  status: string;
  isBoosted?: boolean;
}

interface UserProfile {
  id: string;
  displayName: string;
  photoURL: string;
  averageRating: number;
  totalTrades: number;
  verificationStatus: string;
  lastActiveAt?: any;
}

export default function Home() {
  const { user, profile } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [followedListings, setFollowedListings] = useState<Listing[]>([]);
  const [sellers, setSellers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [recentAlert, setRecentAlert] = useState<string | null>(null);

  useEffect(() => {
    // Active Users Count (last 15 mins)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const q = query(
      collection(db, 'users'),
      where('lastActiveAt', '>=', fifteenMinsAgo)
    );
    
    const unsubscribe = onSnapshot(q, (snap) => {
      setActiveUsersCount(snap.size);
    }, (err) => console.error("Active users sync fail", err));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // New Listing Alert
    const q = query(
      collection(db, 'listings'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    let initial = true;
    const unsubscribe = onSnapshot(q, (snap) => {
      if (initial) {
        initial = false;
        return;
      }
      if (!snap.empty) {
        const item = snap.docs[0].data();
        setRecentAlert(`Live: ${item.title} just posted!`);
        setTimeout(() => setRecentAlert(null), 5000);
      }
    }, (err) => console.error("Listing alert sync fail", err));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function fetchData() {
      console.log('Fetching home data...');
      try {
        setLoading(true);
        setError(null);

        // Fetch Listings
        const qListings = query(
          collection(db, 'listings'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const listingSnap = await getDocs(qListings);
        if (!isMounted) return;
        
        const listingData = listingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Listing));
        console.log('Listings fetched:', listingData.length);
        setListings(listingData);

        // Fetch Sellers
        const qSellers = query(
          collection(db, 'users'),
          where('verificationStatus', '==', 'verified'),
          orderBy('lastActiveAt', 'desc'),
          limit(10)
        );
        const sellerSnap = await getDocs(qSellers);
        if (!isMounted) return;

        const sellerData = sellerSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
        console.log('Sellers fetched:', sellerData.length);
        setSellers(sellerData);

        // Fetch Followed Listings
        if (user) {
          const followQuery = query(
            collection(db, 'follows'),
            where('followerId', '==', user.uid),
            limit(100)
          );
          const followSnap = await getDocs(followQuery);
          const followingIds = followSnap.docs.map(d => d.data().followingId);

          if (followingIds.length > 0) {
            // Firestore 'in' operator supports up to 10-30 values depending on version, 
            // 10 is safe for basic queries.
            const followedListingsQ = query(
              collection(db, 'listings'),
              where('ownerId', 'in', followingIds.slice(0, 10)),
              where('status', '==', 'active'),
              orderBy('createdAt', 'desc'),
              limit(10)
            );
            const followedListingsSnap = await getDocs(followedListingsQ);
            setFollowedListings(followedListingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Listing)));
          }
        }

      } catch (err: any) {
        console.error('Home Page Data Fetch Error:', err);
        setError(err.message || 'Registry synchronization failure.');
        // Don't throw here to avoid infinite loading if catch-throw pattern was used
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    fetchData();
    return () => { isMounted = false; };
  }, []);

  const filteredListings = listings
    .filter(l => l.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(l => {
      const distance = profile?.latitude && l.latitude 
        ? calculateDistance(profile.latitude, profile.longitude, l.latitude, l.longitude)
        : null;
      return { ...l, distance };
    })
    .sort((a, b) => {
      // Prioritize Boosted Listings
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;

      if (nearbyOnly && a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      return 0;
    });

  return (
    <div className="space-y-12 pb-20">
      {/* Search & Orientation */}
      <section className="relative space-y-8 py-10 md:py-20">
        <div className="flex flex-col items-center text-center space-y-6">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-6xl md:text-8xl font-serif text-white tracking-tighter leading-[0.9]"
          >
            Trade <span className="text-amber-500 italic">local</span>. <br /> Trade <span className="text-amber-500 italic">safe</span>.
          </motion.h1>
          <p className="max-w-md text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-relaxed">
            The community marketplace for authenticated goods, secured by protected escrow.
          </p>
        </div>

        <div className="mx-auto max-w-2xl px-4">
          {user && (profile?.totalTrades || 0) === 0 && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-10 rounded-[2.5rem] bg-amber-500 p-8 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative"
            >
              <div className="relative z-10 space-y-1">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-black/40">Quick Start Program</p>
                <h3 className="font-serif text-3xl text-black leading-tight italic">Your first trade is waiting.</h3>
              </div>
              <Link to="/create-listing" className="relative z-10 px-8 py-4 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-900 transition-all shadow-xl">List Item Now</Link>
              <div className="absolute top-0 right-0 h-40 w-40 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl" />
            </motion.div>
          )}

          <div className="group relative flex items-center">
            <Search className="absolute left-6 h-5 w-5 text-slate-600 transition-colors group-focus-within:text-amber-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="What are you looking for today?"
              className="w-full rounded-[2.5rem] border border-white/5 bg-brand-card py-6 pl-16 pr-8 text-sm text-white shadow-2xl focus:border-amber-500/50 focus:outline-none transition-all placeholder:italic"
            />
          </div>
          
          <div className="mt-6 flex justify-center gap-4">
            <Link 
              to="/drivers"
              className="flex items-center gap-3 rounded-full border border-amber-500/30 bg-amber-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:bg-amber-500 hover:text-black transition-all"
            >
              <Truck className="h-4 w-4" />
              Find Drivers
            </Link>
            <button 
              onClick={() => setNearbyOnly(!nearbyOnly)}
              className={`flex items-center gap-3 rounded-full border px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${nearbyOnly ? 'bg-amber-500 border-amber-500 text-black' : 'bg-white/5 border-white/5 text-slate-400 hover:border-amber-500/30'}`}
            >
              <Compass className={`h-4 w-4 ${nearbyOnly ? 'animate-spin-slow' : ''}`} />
              Nearby Only
            </button>
            <button className="flex items-center gap-3 rounded-full border border-white/5 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:border-amber-500/30 transition-all">
              <Filter className="h-4 w-4" />
              Advanced Filters
            </button>
          </div>
        </div>
      </section>

      {/* Verified Merchants */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div>
            <h2 className="font-serif text-2xl text-white">Verified Merchants</h2>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1 italic">Background-checked sellers with proven history</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-500">
            Trusted Sellers <ArrowRight className="h-3 w-3" />
          </div>
        </div>
        
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-40 w-32 shrink-0 rounded-3xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6 text-center text-[10px] font-bold uppercase tracking-wider text-red-500">
            Unable to load merchants: {error}. Please check your connection.
          </div>
        ) : sellers.length === 0 ? (
          <div className="rounded-3xl border border-white/5 bg-black/20 p-6 text-center text-[10px] font-bold uppercase tracking-wider text-slate-600">
            Connecting you with verified sellers soon...
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {sellers.map((seller) => (
              <motion.div 
                whileHover={{ y: -5 }}
                key={seller.id} 
                className="flex w-32 shrink-0 flex-col items-center gap-3 rounded-3xl bg-brand-card p-4 border border-white/5"
              >
                <div className="relative">
                  <img 
                    src={seller.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${seller.id}`} 
                    className="h-16 w-16 rounded-full border-2 border-amber-500/20" 
                    alt="" 
                  />
                  {seller.verificationStatus === 'verified' && (
                    <div className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 p-1">
                      <ShieldCheck className="h-3 w-3 text-black" />
                    </div>
                  )}
                  {/* Activity Signal */}
                  {seller.lastActiveAt && (Date.now() - (seller.lastActiveAt?.toMillis?.() || 0) < 1000 * 60 * 15) && (
                    <div className="absolute top-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-brand-bg shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-semibold text-white truncate w-24">{seller.displayName}</p>
                  <div className="flex items-center justify-center gap-1 text-[8px] font-black text-amber-500 mt-1">
                    <Star className="h-2 w-2 fill-amber-500" />
                    {seller.averageRating?.toFixed(1) || '0.0'}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
      
      {/* Followed Sellers Stream */}
      {user && followedListings.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div>
              <h2 className="font-serif text-2xl text-white">Following</h2>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1 italic">Recent arrivals from sellers you follow</p>
            </div>
            <Link to="/" className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-500">
              Refresh Feed <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide px-2">
            {followedListings.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="group shrink-0 w-64 space-y-4">
                <div className="aspect-[4/3] overflow-hidden rounded-[2.5rem] bg-brand-card border border-white/5 relative">
                  {listing.images?.[0] ? (
                    <img src={listing.images[0]} alt="" className="h-full w-full object-cover grayscale-[0.2] transition-all group-hover:grayscale-0 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-800">NO VISUAL</div>
                  )}
                  <div className="absolute top-4 right-4 rounded-lg bg-black/60 backdrop-blur-md px-3 py-1.5 border border-white/10">
                    <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest">${listing.price.toLocaleString()}</p>
                  </div>
                </div>
                <div className="px-2">
                  <h4 className="font-serif text-lg text-white truncate leading-tight group-hover:text-amber-500 transition-colors">{listing.title}</h4>
                  <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500 mt-1">
                    <MapPin className="h-3 w-3 text-amber-500/50" />
                    <span>{listing.location}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Registry Stream */}
      <section className="space-y-8">
          <div className="flex items-center gap-4 px-2">
            <h2 className="font-serif text-3xl text-white">Marketplace</h2>
            <div className="h-[1px] flex-1 bg-white/5" />
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10 md:flex">
                <div className="h-1 w-1 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[8px] font-bold text-amber-500/70 uppercase tracking-widest">
                  {activeUsersCount > 1 ? `${activeUsersCount} active users` : '12 trades in progress today'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[8px] font-bold text-green-500 uppercase tracking-widest">Live Marketplace</span>
                </div>
                {!loading && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{filteredListings.length} Listings Available</span>
                )}
              </div>
            </div>
          </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-[4/3] rounded-[3rem] bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[3rem] border border-red-500/20 bg-red-500/5 py-32 text-center">
            <p className="font-serif text-xl italic text-red-500">We couldn't connect to the marketplace.</p>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-600">{error}</p>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-40 text-center space-y-6 bg-brand-card rounded-[3rem] border border-white/5 shadow-2xl">
            <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center text-slate-800">
              <Search className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h3 className="font-serif text-2xl text-white">No matches found</h3>
              <p className="text-slate-500 font-serif italic max-w-xs mx-auto">We couldn't find any listings for your current search or category.</p>
            </div>
            <button 
              onClick={() => setSearchQuery('')}
              className="px-8 py-4 rounded-xl bg-white text-[10px] font-bold uppercase tracking-widest text-black hover:bg-amber-500 transition-all shadow-xl active:scale-[0.98]"
            >
              Clear Search & Explore All
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {filteredListings.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`}>
                <motion.article 
                  whileHover={{ scale: 1.02 }}
                  className="group relative overflow-hidden rounded-[3rem] bg-brand-card shadow-2xl border border-white/5"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                    {listing.images?.[0] ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className={`h-full w-full object-cover transition-all duration-700 group-hover:grayscale-0 group-hover:scale-105 ${listing.isBoosted ? 'grayscale-0' : 'grayscale-[0.2]'}`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-800">NO VISUAL</div>
                    )}
                    
                    {listing.isBoosted && (
                      <div className="absolute top-6 left-6 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 border border-black/10 shadow-xl z-10 flex items-center gap-1.5">
                        <Star className="h-3 w-3 text-black fill-black animate-pulse" />
                        <p className="text-[9px] font-black uppercase tracking-widest text-black">Promoted</p>
                      </div>
                    )}

                    {!listing.isBoosted && listing.distance !== null && (
                      <div className="absolute top-6 left-6 rounded-full bg-black/60 backdrop-blur-md px-4 py-2 border border-white/10">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                          {formatDistance(listing.distance)}
                        </p>
                      </div>
                    )}
                    
                    <div className="absolute top-6 right-6 rounded-lg bg-amber-500 px-3 py-1.5 shadow-xl transition-transform group-hover:scale-110">
                      <p className="text-[10px] font-black text-black uppercase tracking-widest">${listing.price.toLocaleString()}</p>
                    </div>
                  </div>

                  <div className="p-8 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 border border-slate-800 rounded-full px-3 py-1">
                        {listing.category}
                      </span>
                    </div>
                    <h3 className="font-serif text-2xl text-white tracking-tight leading-tight group-hover:text-amber-500 transition-colors">
                      {listing.title}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <MapPin className="h-3 w-3 text-amber-500/50" />
                      <span>{listing.location}</span>
                    </div>
                  </div>
                </motion.article>
              </Link>
            ))}
          </div>
        )}
      </section>
      {/* Real-time Alert Toast */}
      <AnimatePresence>
        {recentAlert && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-24 left-1/2 z-50 rounded-full bg-amber-500 px-6 py-3 shadow-2xl border border-white/20"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                <Tag className="h-3 w-3 text-black" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-black">{recentAlert}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
