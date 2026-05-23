import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  query,
  where
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  MapPin,
  Package,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Tag
} from 'lucide-react';
import { motion } from 'motion/react';

import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';

interface Trade {
  id: string;
  listingId: string;
  listingTitle?: string;
  sellerId: string;
  buyerId: string;
  amount: number;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  status: string;
  createdAt: any;
}

interface Listing {
  id: string;
  ownerId: string;
  title: string;
  price: number;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  category?: string;
  location?: string;
  locationName?: string;
  images?: string[];
  status?: string;
  createdAt?: any;
}

const zeroDecimalCurrencies = new Set(['XAF', 'XOF', 'UGX', 'RWF']);

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return (value.seconds || 0) * 1000;
};

const formatDate = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return 'Recent';

  return new Date(millis).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  const normalizedCurrency = currencyCode === 'CFA' ? 'XAF' : currencyCode;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: zeroDecimalCurrencies.has(normalizedCurrency) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${normalizedCurrency} ${(amount || 0).toLocaleString()}`;
  }
};

const formatTradeAmount = (trade: Trade) => {
  if (trade.priceDisplay) return trade.priceDisplay;

  return formatMoney(
    Number(trade.amount || 0),
    trade.currencyCode || trade.currency || 'XAF',
    trade.currencyLocale || 'fr-CM'
  );
};

const formatListingPrice = (listing: Listing) => {
  if (listing.priceDisplay) return listing.priceDisplay;

  return formatMoney(
    Number(listing.price || 0),
    listing.currencyCode || listing.currency || 'XAF',
    listing.currencyLocale || 'fr-CM'
  );
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'pending':
      return <Clock className="h-4 w-4 text-amber-500" />;
    default:
      return <Tag className="h-4 w-4 text-zinc-400" />;
  }
};

const getStatusLabel = (status: string) => {
  if (status === 'funded') return 'Payment in Escrow';

  return status
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export default function Trades() {
  const { user } = useAuth();

  const [trades, setTrades] = useState<Trade[]>([]);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchLedger = async () => {
      if (!user) {
        setLoading(false);
        setListingsLoading(false);
        return;
      }

      try {
        setLoading(true);
        setListingsLoading(true);
        setError(null);

        const tradesRef = collection(db, 'trades');
        const listingsRef = collection(db, 'listings');

        // No orderBy here: avoids composite-index failure while we sort locally.
        const qBuyer = query(
          tradesRef,
          where('buyerId', '==', user.uid),
          limit(50)
        );

        const qSeller = query(
          tradesRef,
          where('sellerId', '==', user.uid),
          limit(50)
        );

        const qListings = query(
          listingsRef,
          where('ownerId', '==', user.uid),
          limit(50)
        );

        const [buyerSnap, sellerSnap, listingSnap] = await Promise.all([
          getDocs(qBuyer),
          getDocs(qSeller),
          getDocs(qListings)
        ]);

        if (!isMounted) return;

        const mergedTrades = [
          ...buyerSnap.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })),
          ...sellerSnap.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          }))
        ] as Trade[];

        const uniqueTrades = Array.from(
          new Map(mergedTrades.map(trade => [trade.id, trade])).values()
        ).sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

        const listings = listingSnap.docs
          .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as Listing[];

        setTrades(uniqueTrades);
        setMyListings(
          listings.sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
        );
      } catch (err) {
        const message = handleFirestoreError(
          err,
          OperationType.READ,
          'trades/listings'
        );

        setError(message || 'Failed to load your trade history.');
      } finally {
        if (isMounted) {
          setLoading(false);
          setListingsLoading(false);
        }
      }
    };

    fetchLedger();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const hasTrades = trades.length > 0;
  const hasListings = myListings.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-24">
      <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-3xl tracking-tight text-white">
            Your Trades
          </h2>
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Active deals, escrow conversations, and your posted marketplace items
          </p>
        </div>

        <Link
          to="/create-listing"
          className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" />
          New Listing
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(item => (
            <div
              key={item}
              className="h-24 w-full animate-pulse rounded-2xl bg-white/5"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[3rem] border border-red-500/20 bg-red-500/5 p-20 text-center">
          <p className="font-serif text-xl italic text-red-500">
            We could not load your trades.
          </p>
          <p className="mt-4 break-words text-[10px] uppercase tracking-wider text-slate-600">
            {error}
          </p>
        </div>
      ) : hasTrades ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h3 className="font-serif text-xl text-white">Active Trade Ledger</h3>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
              {trades.length} records
            </span>
          </div>

          <div className="space-y-3">
            {trades.map(trade => {
              const buying = trade.buyerId === user?.uid;

              return (
                <motion.div
                  key={trade.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ x: 4 }}
                  transition={{ duration: 0.2 }}
                >
                  <Link
                    to={`/trade/${trade.id}`}
                    className="flex items-center justify-between rounded-2xl border border-white/5 bg-brand-card p-5 shadow-2xl transition-all hover:border-amber-500/30"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                          buying
                            ? 'bg-amber-600/10 text-amber-500'
                            : 'bg-slate-100/10 text-slate-400'
                        }`}
                      >
                        {buying ? (
                          <ShoppingCart className="h-6 w-6" />
                        ) : (
                          <Tag className="h-6 w-6" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">
                            {trade.listingTitle || `Trade #${trade.id.slice(-6).toUpperCase()}`}
                          </span>

                          <div
                            className={`flex items-center gap-2 rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                              trade.status === 'completed'
                                ? 'border-green-600/30 bg-green-600/10 text-green-500'
                                : trade.status === 'pending'
                                  ? 'border-amber-600/30 bg-amber-600/10 text-amber-500'
                                  : 'border-white/10 bg-slate-800 text-slate-400'
                            }`}
                          >
                            {getStatusIcon(trade.status)}
                            {getStatusLabel(trade.status)}
                          </div>
                        </div>

                        <p className="mt-2 text-xs font-serif italic text-slate-500">
                          {buying ? 'Buying' : 'Selling'} for {formatTradeAmount(trade)} • {formatDate(trade.createdAt)}
                        </p>
                      </div>
                    </div>

                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-700" />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div>
            <h3 className="font-serif text-xl text-white">Your Listed Items</h3>
            <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-600">
              Posted products appear here before they become trades
            </p>
          </div>

          <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
            {myListings.length} listings
          </span>
        </div>

        {listingsLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {[1, 2, 3].map(item => (
              <div
                key={item}
                className="h-56 animate-pulse rounded-2xl bg-white/5"
              />
            ))}
          </div>
        ) : hasListings ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {myListings.map(listing => (
              <motion.article
                key={listing.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -3 }}
                className="overflow-hidden rounded-2xl border border-white/5 bg-brand-card shadow-xl"
              >
                <Link to={`/listing/${listing.id}`} className="block">
                  <div className="relative aspect-[4/3] bg-slate-950">
                    {listing.images?.[0] ? (
                      <img
                        src={listing.images[0]}
                        alt={listing.title}
                        className="h-full w-full object-cover grayscale-[0.15] transition hover:scale-105 hover:grayscale-0"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] font-black uppercase tracking-widest text-slate-800">
                        No Visual
                      </div>
                    )}

                    <div className="absolute right-3 top-3 max-w-[72%] rounded-lg bg-amber-500 px-2.5 py-1.5">
                      <p className="truncate text-[8px] font-black uppercase tracking-widest text-black">
                        {formatListingPrice(listing)}
                      </p>
                    </div>

                    <div
                      className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[7px] font-black uppercase tracking-widest ${
                        listing.status === 'active'
                          ? 'border-green-500/20 bg-green-500/10 text-green-400'
                          : 'border-white/10 bg-black/60 text-slate-400'
                      }`}
                    >
                      {listing.status || 'active'}
                    </div>
                  </div>
                </Link>

                <div className="space-y-3 p-4">
                  <span className="inline-flex rounded-full border border-slate-800 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
                    {listing.category || 'Listing'}
                  </span>

                  <Link to={`/listing/${listing.id}`}>
                    <h4 className="line-clamp-2 min-h-[2.5rem] font-serif text-base leading-tight text-white hover:text-amber-500">
                      {listing.title}
                    </h4>
                  </Link>

                  <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0 text-amber-500/50" />
                    <span className="truncate">
                      {listing.locationName || listing.location || 'Marketplace'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Link
                      to={`/listing/${listing.id}`}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[8px] font-black uppercase tracking-widest text-white hover:bg-white hover:text-black"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </Link>

                    <Link
                      to="/create-listing"
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-3 text-[8px] font-black uppercase tracking-widest text-black hover:bg-amber-400"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Add More
                    </Link>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-[3rem] border border-white/5 bg-brand-card p-16 text-center shadow-2xl">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-slate-800">
              <ShoppingBag className="h-10 w-10" />
            </div>

            <h3 className="mt-6 font-serif text-2xl text-white">
              No listed items yet
            </h3>

            <p className="mx-auto mt-2 max-w-xs font-serif italic text-slate-500">
              Products you post for sale will appear here, even before buyers start a trade.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                to="/"
                className="rounded-xl bg-white px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black shadow-xl transition-all hover:bg-amber-500"
              >
                Browse Items
              </Link>

              <Link
                to="/create-listing"
                className="rounded-xl border border-white/10 bg-brand-card px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/5"
              >
                Start Selling
              </Link>
            </div>
          </div>
        )}
      </section>

      {!loading && !hasTrades && !hasListings && (
        <div className="flex flex-col items-center justify-center rounded-[3rem] border border-white/5 bg-brand-card p-16 text-center shadow-2xl">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-slate-800">
            <ShoppingCart className="h-10 w-10" />
          </div>

          <h3 className="mt-6 font-serif text-2xl text-white">
            Your marketplace activity starts here
          </h3>

          <p className="mx-auto mt-2 max-w-xs font-serif italic text-slate-500">
            Find your first item, start a trade, or post your own listing.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              to="/"
              className="rounded-xl bg-white px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-black shadow-xl transition-all hover:bg-amber-500"
            >
              Browse Items
            </Link>

            <Link
              to="/create-listing"
              className="rounded-xl border border-white/10 bg-brand-card px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/5"
            >
              Start Selling
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
