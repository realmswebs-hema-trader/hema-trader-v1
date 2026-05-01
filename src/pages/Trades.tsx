import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { Link } from 'react-router-dom';
import { ShoppingCart, Tag, Clock, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface Trade {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  amount: number;
  status: string;
  createdAt: any;
}

export default function Trades() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchTrades = async () => {
      if (!user) return;
      console.log('Fetching ledger for user:', user.uid);
      try {
        setLoading(true);
        setError(null);
        
        const tradesRef = collection(db, 'trades');
        
        // Fetch buyer and seller trades in parallel
        const qBuyer = query(tradesRef, where('buyerId', '==', user.uid), orderBy('createdAt', 'desc'));
        const qSeller = query(tradesRef, where('sellerId', '==', user.uid), orderBy('createdAt', 'desc'));
        
        const [buyerSnap, sellerSnap] = await Promise.all([getDocs(qBuyer), getDocs(qSeller)]);
        
        if (!isMounted) return;

        const mergedTrades = [
          ...buyerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
          ...sellerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        ] as Trade[];
        
        console.log('Ledger sync complete:', mergedTrades.length, 'entries');

        // Remove duplicates and sort
        const uniqueTrades = Array.from(new Map(mergedTrades.map(t => [t.id, t])).values())
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        setTrades(uniqueTrades);
      } catch (err: any) {
        console.error('Fetch Order History Error:', err);
        setError(err.message || 'Failed to load your trade history.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchTrades();
    return () => { isMounted = false; };
  }, [user]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'pending': return <Clock className="h-4 w-4 text-amber-500" />;
      default: return <Tag className="h-4 w-4 text-zinc-400" />;
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h2 className="font-serif text-3xl text-white tracking-tight">Your Trades</h2>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 w-full animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[3rem] border border-red-500/20 bg-red-500/5 p-24 text-center">
          <p className="font-serif text-xl italic text-red-500">We couldn't load your trades.</p>
          <p className="mt-4 text-[10px] uppercase tracking-wider text-slate-600">{error}</p>
        </div>
      ) : trades.length > 0 ? (
        <div className="space-y-4">
          {trades.map((trade) => (
            <motion.div key={trade.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ x: 8 }} transition={{ duration: 0.2 }}>
              <Link
                to={`/trade/${trade.id}`}
                className="flex items-center justify-between rounded-2xl bg-brand-card p-6 shadow-2xl border border-white/5 hover:border-amber-500/30 transition-all transition-colors"
              >
                <div className="flex items-center gap-6">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${trade.buyerId === user?.uid ? 'bg-amber-600/10 text-amber-500' : 'bg-slate-100/10 text-slate-400'}`}>
                    {trade.buyerId === user?.uid ? <ShoppingCart className="h-7 w-7" /> : <Tag className="h-7 w-7" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-white tracking-wider text-xs uppercase">Trade #{trade.id.slice(-6).toUpperCase()}</span>
                      <div className={`flex items-center gap-2 rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                        trade.status === 'completed' ? 'bg-green-600/10 text-green-500 border-green-600/30' : 
                        trade.status === 'pending' ? 'bg-amber-600/10 text-amber-500 border-amber-600/30' : 'bg-slate-800 text-slate-400 border-white/10'
                      }`}>
                        {getStatusIcon(trade.status)}
                        {trade.status === 'funded' ? 'Payment in Escrow' : trade.status}
                      </div>
                    </div>
                    <p className="mt-2 text-xs font-serif italic text-slate-500">
                      {trade.buyerId === user?.uid ? `Buying for $${trade.amount}` : `Selling for $${trade.amount}`}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-6 w-6 text-slate-700" />
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-24 text-center bg-brand-card rounded-[3rem] border border-white/5 shadow-2xl space-y-6">
          <div className="h-20 w-20 rounded-full bg-white/5 flex items-center justify-center text-slate-800">
            <ShoppingCart className="h-10 w-10" />
          </div>
          <div className="space-y-2">
            <h3 className="font-serif text-2xl text-white">No trades yet</h3>
            <p className="text-slate-500 font-serif italic max-w-xs mx-auto">Your journey on Hema Trader starts here. Find your first item or post your own listing!</p>
          </div>
          <div className="flex gap-4">
            <Link to="/" className="px-8 py-4 rounded-xl bg-white text-[10px] font-bold uppercase tracking-widest text-black hover:bg-amber-500 transition-all shadow-xl">
              Browse Items
            </Link>
            <Link to="/create-listing" className="px-8 py-4 rounded-xl border border-white/10 bg-brand-card text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white/5 transition-all">
              Start Selling
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
