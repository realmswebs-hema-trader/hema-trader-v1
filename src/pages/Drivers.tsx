import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Loader2, MapPin, Search, Star, Truck } from 'lucide-react';
import { motion } from 'motion/react';

import { db } from '../lib/firebase';

interface Driver {
  id: string;
  displayName?: string;
  name?: string;
  email?: string;
  photoURL?: string;
  roles?: string[];
  isOnline?: boolean;
  driverStatus?: string;
  availability?: string;
  avgDriverRating?: number;
  averageRating?: number;
  deliveriesCount?: number;
  vehicleType?: string;
  vehicleSize?: string;
  location?: string;
  city?: string;
  country?: string;
}

const displayName = (driver: Driver) =>
  driver.displayName || driver.name || driver.email || 'Driver';

const displayLocation = (driver: Driver) =>
  driver.location ||
  [driver.city, driver.country].filter(Boolean).join(', ') ||
  'Cameroon';

const isAvailable = (driver: Driver) =>
  driver.isOnline || driver.driverStatus === 'available' || driver.availability === 'available';

export default function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'users'), limit(200)), snap => {
      setDrivers(
        snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Driver))
          .filter(driver => driver.roles?.includes('driver') || driver.driverStatus || driver.availability)
          .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)))
      );
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredDrivers = drivers.filter(driver =>
    [displayName(driver), displayLocation(driver), driver.vehicleType]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pb-24 pt-8">
      <div className="text-center">
        <h1 className="font-serif text-4xl text-white">Available Drivers</h1>
        <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">
          Real-time delivery agents in the Hema Trader network
        </p>
      </div>

      <div className="relative mx-auto max-w-xl">
        <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search drivers, vehicles, or locations"
          className="w-full rounded-2xl border border-white/10 bg-brand-card py-4 pl-12 pr-5 text-sm text-white outline-none focus:border-amber-500/50"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filteredDrivers.map(driver => {
            const available = isAvailable(driver);
            const rating = driver.avgDriverRating || driver.averageRating || 0;

            return (
              <motion.article
                key={driver.id}
                whileHover={{ y: -4 }}
                className="rounded-2xl border border-white/10 bg-brand-card p-5 shadow-2xl"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="relative">
                    <img
                      src={driver.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${driver.id}`}
                      alt={displayName(driver)}
                      className="h-20 w-20 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <span className={`absolute right-1 top-1 h-3 w-3 rounded-full ${available ? 'animate-pulse bg-green-500' : 'bg-slate-600'}`} />
                  </div>

                  <h2 className="mt-4 font-serif text-xl text-white">{displayName(driver)}</h2>
                  <p className={`text-[10px] font-bold ${available ? 'text-green-500' : 'text-slate-500'}`}>
                    {available ? 'Available' : 'Offline'}
                  </p>

                  <div className="mt-3 flex items-center gap-1 text-amber-500">
                    <Star className="h-4 w-4 fill-amber-500" />
                    <span className="text-sm font-bold">{rating.toFixed(1)}</span>
                  </div>

                  <p className="mt-2 text-sm text-slate-400">
                    {driver.deliveriesCount || 0} Deliveries
                  </p>

                  <p className="mt-2 text-xs text-slate-500">
                    <Truck className="mr-1 inline h-3 w-3" />
                    {driver.vehicleType || 'Vehicle'} • {driver.vehicleSize || 'Medium'}
                  </p>

                  <p className="mt-2 text-xs text-slate-500">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    {displayLocation(driver)}
                  </p>

                  <Link
                    to={`/drivers/${driver.id}`}
                    className="mt-5 w-full rounded-xl bg-green-500/10 py-3 text-[10px] font-black uppercase tracking-widest text-green-400 hover:bg-green-500 hover:text-black"
                  >
                    Hire Driver
                  </Link>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
}
