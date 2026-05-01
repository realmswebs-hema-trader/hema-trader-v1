import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { Truck, MapPin, Star, Filter, Search, ChevronRight, Loader2, Navigation } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';

interface Driver {
  id: string;
  displayName: string;
  photoURL: string;
  driverStatus: string;
  vehicleType: string;
  avgDriverRating?: number;
  deliveriesCount?: number;
  latitude?: number;
  longitude?: number;
  distance?: number;
}

export default function DriverDiscovery() {
  const { user, profile } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'available'>('available');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('roles', 'array-contains', 'driver'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const driverList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Driver));
      
      // Calculate distances if user location available
      const enriched = driverList.map(driver => {
        if (profile?.latitude && profile?.longitude && driver.latitude && driver.longitude) {
          const dist = calculateDistance(
            profile.latitude,
            profile.longitude,
            driver.latitude,
            driver.longitude
          );
          return { ...driver, distance: dist };
        }
        return driver;
      });

      setDrivers(enriched);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const filteredDrivers = drivers
    .filter(d => {
      const matchesFilter = filter === 'all' || d.driverStatus === 'available';
      const matchesSearch = d.displayName?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => (a.distance || 999) - (b.distance || 999));

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 pb-24 pt-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-serif text-4xl text-white tracking-tight">Delivery Partners</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-black">Find trusted drivers in your region</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
           <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-amber-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search drivers..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 rounded-2xl bg-black/40 border border-white/5 pl-11 pr-5 py-3 text-xs text-white focus:outline-none focus:border-amber-500 transition-all"
            />
          </div>

          <div className="flex gap-1 rounded-2xl bg-black/40 p-1 border border-white/5">
            <button
              onClick={() => setFilter('available')}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                filter === 'available' ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Available
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                filter === 'all' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredDrivers.length > 0 ? filteredDrivers.map((driver) => (
            <motion.div
              key={driver.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="group relative overflow-hidden rounded-[2.5rem] bg-brand-card p-1 border border-white/5 shadow-2xl transition-all hover:border-amber-500/30"
            >
              <div className="flex items-center p-6 gap-6">
                <div className="relative">
                  <div className="h-20 w-20 rounded-3xl border-2 border-white/10 overflow-hidden shadow-inner group-hover:border-amber-500/50 transition-colors">
                    <img src={driver.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className={`absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-4 border-brand-card flex items-center justify-center ${
                    driver.driverStatus === 'available' ? 'bg-green-500' : 'bg-slate-700'
                  }`}>
                    {driver.driverStatus === 'available' && <div className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />}
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-xl text-white tracking-tight">{driver.displayName}</h3>
                    {driver.distance !== undefined && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded-md">
                        {driver.distance.toFixed(1)} km
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                      <span className="text-[10px] font-bold text-white">{driver.avgDriverRating || 'New'}</span>
                    </div>
                    <div className="h-1 w-1 rounded-full bg-slate-800" />
                    <div className="flex items-center gap-1.5">
                      <Truck className="h-3 w-3" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">{driver.vehicleType}</span>
                    </div>
                  </div>

                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-black">
                    {driver.deliveriesCount || 0} SEAMLESS DELIVERIES
                  </p>
                </div>

                <Link 
                  to={`/profile/${driver.id}`}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-500 hover:bg-white hover:text-black transition-all"
                >
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </div>
            </motion.div>
          )) : (
            <div className="col-span-full py-20 text-center space-y-4">
              <div className="h-20 w-20 rounded-full bg-slate-900 mx-auto flex items-center justify-center">
                <Filter className="h-8 w-8 text-slate-700" />
              </div>
              <div>
                <h3 className="font-serif text-2xl text-slate-400">No matching drivers</h3>
                <p className="text-[10px] uppercase tracking-widest text-slate-600">Try adjusting your filters or search terms</p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
