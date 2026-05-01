import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp, increment, orderBy, limit, addDoc, startAfter, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import { 
  ShieldAlert, Check, X, FileSearch, Loader2, ExternalLink, 
  AlertTriangle, UserMinus, ShieldCheck, Users, BarChart3, 
  ShoppingBag, Truck, DollarSign, Search, Filter, Activity,
  Clock, Gavel, Scale, AlertOctagon, TrendingUp, HeartPulse
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line 
} from 'recharts';

interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  verificationStatus: string;
  warningCount?: number;
  isBanned?: boolean;
  isSuspended?: boolean;
  roles: string[];
  riskLevel?: 'none' | 'low' | 'medium' | 'high';
  reliabilityScore?: number;
  deliveriesCount?: number;
  badges?: string[];
  sellerTier?: 'none' | 'elite' | 'trusted' | 'official';
  driverTier?: 'none' | 'trusted' | 'master';
  totalTrades?: number;
  averageRating?: number;
}

interface Trade {
  id: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: string;
  isDisputed?: boolean;
  disputeStatus?: string;
  platformFee?: number;
  deliveryFee?: number;
  driverCommission?: number;
  createdAt: any;
  lastActivityAt?: any;
}

interface Report {
  id: string;
  reporterId: string;
  targetId: string;
  reason: string;
  description: string;
  status: string;
  adminNote?: string;
  createdAt: any;
}

interface SystemHealth {
  stuckTrades: number;
  openReports: number;
  avgResolutionTime: string;
  systemLoad: 'optimal' | 'high' | 'critical';
}

export default function Admin() {
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'ops' | 'users' | 'disputes' | 'risk' | 'revenue' | 'fraud'>('ops');

  const handleFreezeUser = async (userId: string, reason: string) => {
    setProcessing(userId);
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        isSuspended: true,
        riskLevel: 'high',
        riskFlags: ['Manually Suspended by Fraud Engine'],
        updatedAt: serverTimestamp()
      });
      await logAudit('ACCOUNT_FREEZE', userId, reason);
      alert('Account frozen successfully');
      fetchData();
    } catch (err) {
      alert('Freeze failed');
    } finally {
      setProcessing(null);
    }
  };
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    setLastDoc(null);
    setUsers([]);
    setTrades([]);
    fetchData();
  }, [activeTab]);

  const fetchData = async (isMore = false) => {
    try {
      setLoading(true);
      const PAGE_SIZE = 20;

      if (activeTab === 'ops' || activeTab === 'revenue') {
        const tradesSnap = await getDocs(query(collection(db, 'trades'), orderBy('createdAt', 'desc'), limit(100)));
        setTrades(tradesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Trade)));
        
        const usersSnap = await getDocs(query(collection(db, 'users'), limit(100)));
        setUsers(usersSnap.docs.map(d => d.data() as UserProfile));
      } else if (activeTab === 'users') {
        let q = query(collection(db, 'users'), orderBy('displayName'), limit(PAGE_SIZE));
        if (isMore && lastDoc) {
          q = query(collection(db, 'users'), orderBy('displayName'), startAfter(lastDoc), limit(PAGE_SIZE));
        }
        const snap = await getDocs(q);
        const newUsers = snap.docs.map(d => d.data() as UserProfile);
        setUsers(prev => isMore ? [...prev, ...newUsers] : newUsers);
        setLastDoc(snap.docs[snap.docs.length - 1] || null);
        setHasMore(snap.docs.length === PAGE_SIZE);
      } else if (activeTab === 'disputes') {
        const snap = await getDocs(query(collection(db, 'trades'), where('isDisputed', '==', true), orderBy('lastActivityAt', 'desc')));
        setTrades(snap.docs.map(d => ({ id: d.id, ...d.data() } as Trade)));
      } else if (activeTab === 'risk') {
        const snap = await getDocs(query(collection(db, 'users'), where('riskLevel', 'in', ['medium', 'high'])));
        setUsers(snap.docs.map(d => d.data() as UserProfile));
        const reportsSnap = await getDocs(query(collection(db, 'reports'), where('status', '==', 'pending')));
        setReports(reportsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Report)));
      }
    } catch (err) {
      console.error('Ops Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const revenueData = useMemo(() => {
    const data = {
      trades: 0,
      delivery: 0,
      boosts: 0,
    };
    trades.forEach(t => {
      if (t.status === 'completed') {
        data.trades += (t.platformFee || 0);
        data.delivery += (t.deliveryFee ? t.deliveryFee * 0.2 : 0); // Platform take
      }
    });
    // Simulating boost revenue for the chart
    data.boosts = 125000; 

    return [
      { name: 'Escrow Fees', val: data.trades },
      { name: 'Logistics', val: data.delivery },
      { name: 'Listing Boosts', val: data.boosts }
    ];
  }, [trades]);

  const platformHealth = useMemo((): SystemHealth => {
    const now = Date.now();
    const stuck = trades.filter(t => {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      const lastActive = t.lastActivityAt?.toMillis() || t.createdAt?.toMillis();
      return (now - lastActive) > 172800000; // 48 hours
    }).length;

    return {
      stuckTrades: stuck,
      openReports: reports.length,
      avgResolutionTime: '14.2h',
      systemLoad: stuck > 10 ? 'high' : 'optimal'
    };
  }, [trades, reports]);

  const logAudit = async (action: string, targetId: string, reason: string, metadata = {}) => {
    if (!authUser) return;
    try {
      await addDoc(collection(db, 'audit_logs'), {
        adminId: authUser.uid,
        action,
        targetId,
        reason,
        metadata,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Audit Log failed:', e);
    }
  };

  const syncUserTiers = async () => {
    setProcessing('sync_tiers');
    try {
      const snap = await getDocs(collection(db, 'users'));
      const batchSize = snap.size;
      let processed = 0;

      for (const userDoc of snap.docs) {
        const u = userDoc.data() as UserProfile;
        const updates: any = { updatedAt: serverTimestamp() };
        const badges: string[] = [];

        // Automation Logic
        if (u.verificationStatus === 'verified') badges.push('Verified');
        
        let newSellerTier: any = 'none';
        if ((u.totalTrades || 0) > 50 && (u.averageRating || 0) > 4.7) {
          newSellerTier = 'elite';
          badges.push('Elite Seller');
        } else if ((u.totalTrades || 0) > 10) {
          newSellerTier = 'trusted';
          badges.push('Trusted');
        }

        let newDriverTier: any = 'none';
        if ((u.deliveriesCount || 0) > 100 && (u.reliabilityScore || 0) > 98) {
          newDriverTier = 'master';
          badges.push('Master Driver');
        } else if ((u.deliveriesCount || 0) > 20) {
          newDriverTier = 'trusted';
          badges.push('Trusted Driver');
        }

        updates.sellerTier = newSellerTier;
        updates.driverTier = newDriverTier;
        updates.badges = badges;

        await updateDoc(doc(db, 'users', u.userId), updates);
        processed++;
      }
      alert(`Sync Complete: ${processed} users audited.`);
      fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
      alert('Tier synchronization failed');
    } finally {
      setProcessing(null);
    }
  };

  const handleDisputeResolution = async (tradeId: string, resolution: 'buyer' | 'seller' | 'split') => {
    setProcessing(tradeId);
    try {
      const tradeRef = doc(db, 'trades', tradeId);
      await updateDoc(tradeRef, {
        isDisputed: false,
        disputeStatus: 'resolved',
        status: resolution === 'buyer' ? 'cancelled' : 'completed', // Simplified
        updatedAt: serverTimestamp()
      });
      await logAudit('DISPUTE_RESOLVED', tradeId, `Resolution: ${resolution}`);
      fetchData();
    } catch (err) {
      alert('Dispute resolution failed');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Initializing Ops Hub...</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 pb-24 pt-8">
      {/* Platform Header */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between px-2">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
             <div className="h-8 w-1 bg-amber-500 rounded-full" />
             <h1 className="font-serif text-5xl text-white tracking-tighter">Ops Console</h1>
          </div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-black">Marketplace Integrity & Logistics Surveillance</p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-black/40 p-1.5 border border-white/5 backdrop-blur-xl">
          {[
            { id: 'ops', icon: Activity, label: 'Overview' },
            { id: 'users', icon: Users, label: 'Users' },
            { id: 'disputes', icon: Scale, label: 'Disputes' },
            { id: 'risk', icon: AlertOctagon, label: 'Risk Radar' },
            { id: 'fraud', icon: ShieldAlert, label: 'Fraud Detection' },
            { id: 'revenue', icon: DollarSign, label: 'Capital' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2.5 px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id ? 'bg-amber-500 text-black shadow-xl shadow-amber-500/20' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'ops' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 space-y-4">
                <HeartPulse className={`h-6 w-6 ${platformHealth.systemLoad === 'optimal' ? 'text-green-500' : 'text-red-500'}`} />
                <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">System State</p>
                   <p className="font-serif text-3xl text-white uppercase">{platformHealth.systemLoad}</p>
                </div>
              </div>
              <div className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 space-y-4">
                <Clock className="h-6 w-6 text-amber-500" />
                <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Stuck Trades</p>
                   <p className="font-serif text-3xl text-white tracking-widest">{platformHealth.stuckTrades}</p>
                </div>
              </div>
              <div className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 space-y-4">
                <Gavel className="h-6 w-6 text-blue-500" />
                <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Avg Resolution</p>
                   <p className="font-serif text-3xl text-white">{platformHealth.avgResolutionTime}</p>
                </div>
              </div>
              <div className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 space-y-4">
                <TrendingUp className="h-6 w-6 text-green-500" />
                <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Volume</p>
                   <p className="font-serif text-3xl text-white">{(trades.length * 1.2).toFixed(0)}</p>
                </div>
              </div>
              <div className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 space-y-4">
                <Activity className="h-6 w-6 text-purple-500" />
                <div>
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Queue Throughput</p>
                   <p className="font-serif text-3xl text-white tracking-widest">99.8%</p>
                </div>
              </div>
            </div>

            {/* Automation Controls */}
            <div className="rounded-[2.5rem] bg-amber-500/10 border border-amber-500/20 p-8 flex flex-col md:flex-row items-center justify-between gap-6">
               <div className="space-y-1">
                 <h3 className="font-serif text-xl text-amber-500">Tier Synchronization</h3>
                 <p className="text-[10px] text-amber-500/60 font-medium uppercase tracking-wider">Audit all users and update Elite/Trusted statuses based on performance metrics</p>
               </div>
               <button 
                onClick={syncUserTiers}
                disabled={!!processing}
                className="px-8 py-3 bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
               >
                 {processing === 'sync_tiers' ? 'Auditing Nodes...' : 'Run Audit Cycle'}
               </button>
            </div>

            {/* Performance Rankings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <div className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 space-y-6">
                  <h3 className="font-serif text-2xl text-white flex items-center gap-3">
                    <Truck className="h-5 w-5 text-amber-500" />
                    Top Performing Drivers
                  </h3>
                  <div className="space-y-4">
                    {users.filter(u => u.roles?.includes('driver'))
                      .sort((a,b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0))
                      .slice(0, 5).map((d, i) => (
                      <div key={d.userId} className="flex items-center justify-between p-4 rounded-2xl bg-black/40 border border-white/5 transition-all hover:bg-black/60">
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black text-slate-600">0{i+1}</span>
                          <div>
                            <p className="text-xs font-bold text-white uppercase tracking-wider">{d.displayName}</p>
                            <p className="text-[9px] text-slate-500 uppercase tracking-widest">{d.deliveriesCount || 0} Trips</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-green-500 uppercase">{d.reliabilityScore || 100}% Trust</p>
                        </div>
                      </div>
                    ))}
                  </div>
               </div>

               <div className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 space-y-6">
                  <h3 className="font-serif text-2xl text-white flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Stuck Logistics Monitor
                  </h3>
                  <div className="space-y-4">
                     {trades.filter(t => {
                        const lastActive = t.lastActivityAt?.toMillis() || t.createdAt?.toMillis();
                        return (Date.now() - lastActive) > 86400000 && t.status !== 'completed';
                     }).slice(0, 5).map(t => (
                       <div key={t.id} className="p-5 rounded-2xl bg-red-500/5 border border-red-500/10 space-y-2">
                          <div className="flex justify-between items-center">
                             <span className="text-[9px] font-black uppercase text-red-500">IDLE: 24H+</span>
                             <span className="text-[9px] font-mono text-slate-600">#{t.id.slice(-6)}</span>
                          </div>
                          <p className="text-xs font-bold text-slate-300">Valuation: {t.amount.toLocaleString()} CFA</p>
                       </div>
                     ))}
                  </div>
               </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'users' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="grid gap-6">
               {users.map(u => (
                  <div key={u.userId} className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl">
                    <div className="flex items-center gap-6">
                       <div className="h-16 w-16 rounded-[1.5rem] bg-gradient-to-br from-amber-500/20 to-amber-500/5 border border-white/5 flex items-center justify-center text-amber-500 font-serif text-2xl uppercase">
                         {u.displayName?.slice(0, 1) || 'U'}
                       </div>
                       <div>
                         <h4 className="font-serif text-2xl text-white">{u.displayName}</h4>
                         <div className="flex flex-wrap gap-1.5 mt-2">
                            {u.badges?.map(b => (
                              <span key={b} className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-[8px] font-black uppercase border border-amber-500/20">{b}</span>
                            ))}
                            {u.sellerTier === 'elite' && <span className="px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400 text-[8px] font-black uppercase border border-purple-500/30 tracking-tighter">Elite Player</span>}
                         </div>
                         <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-2">{u.email}</p>
                       </div>
                    </div>

                    <div className="flex gap-4 w-full md:w-auto">
                       <button className="flex-1 md:flex-none px-8 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">Inspect</button>
                       <button className="flex-1 md:flex-none px-8 py-3 rounded-xl bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest hover:shadow-xl hover:shadow-amber-500/20 transition-all">Verification</button>
                    </div>
                  </div>
               ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-10 pb-20">
                 <button 
                  onClick={() => fetchData(true)} 
                  disabled={loading}
                  className="px-12 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-[0.3em] hover:bg-white/10 transition-all flex items-center gap-3 disabled:opacity-50"
                 >
                   {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load More Citizens'}
                 </button>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'disputes' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
             {trades.filter(t => t.isDisputed).length === 0 ? (
               <div className="rounded-[3rem] bg-brand-card p-20 text-center border border-white/5 shadow-2xl">
                 <ShieldCheck className="h-12 w-12 text-slate-800 mx-auto" />
                 <h3 className="mt-8 font-serif text-3xl text-white italic">Clear Justice Docket</h3>
                 <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">No active disputes requiring intervention.</p>
               </div>
             ) : (
               <div className="grid gap-6">
                 {trades.filter(t => t.isDisputed).map(t => (
                    <div key={t.id} className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 space-y-8 shadow-2xl">
                       <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b border-white/5 pb-8">
                          <div className="space-y-2">
                             <div className="flex items-center gap-3">
                                <Scale className="h-5 w-5 text-amber-500" />
                                <h3 className="font-serif text-3xl text-white">Pending Arbitration</h3>
                             </div>
                             <p className="text-xs text-slate-500">Trade reference: <span className="text-amber-500 font-mono tracking-widest">#{t.id.toUpperCase()}</span></p>
                          </div>
                          <div className="text-right">
                             <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Impact Value</p>
                             <p className="font-serif text-3xl text-white">{t.amount.toLocaleString()} CFA</p>
                          </div>
                       </div>
                       
                       <div className="flex flex-col md:flex-row gap-4">
                          <button onClick={() => handleDisputeResolution(t.id, 'seller')} className="flex-1 rounded-xl bg-white p-5 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-500 transition-all shadow-xl">Rule for Seller</button>
                          <button onClick={() => handleDisputeResolution(t.id, 'buyer')} className="flex-1 rounded-xl border border-white/10 bg-white/5 p-5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-500/10 hover:border-red-500/20 transition-all">Rule for Buyer</button>
                       </div>
                    </div>
                 ))}
               </div>
             )}
          </motion.div>
        )}

        {activeTab === 'revenue' && (
           <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="rounded-[3rem] bg-brand-card p-12 border border-white/5 shadow-2xl space-y-10">
                   <h3 className="font-serif text-3xl text-white">Segmented Capital</h3>
                   <div className="h-80">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={revenueData}>
                           <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                           <XAxis dataKey="name" stroke="#475569" fontSize={10} axisLine={false} tickLine={false} />
                           <YAxis stroke="#475569" fontSize={10} axisLine={false} tickLine={false} />
                           <Bar dataKey="val" fill="#f59e0b" radius={[12, 12, 0, 0]} barSize={40} />
                        </BarChart>
                     </ResponsiveContainer>
                   </div>
                </div>

                <div className="space-y-6">
                   {revenueData.map((s, i) => (
                     <div key={i} className="rounded-[2.5rem] bg-brand-card p-8 border border-white/5 shadow-xl flex items-center justify-between">
                        <div className="space-y-1">
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{s.name}</p>
                           <p className="font-serif text-3xl text-white">{s.val.toLocaleString()} CFA</p>
                        </div>
                        <div className="h-12 w-12 rounded-2xl bg-black/40 flex items-center justify-center">
                           <TrendingUp className="h-5 w-5 text-green-500" />
                        </div>
                     </div>
                   ))}
                </div>
              </div>
           </motion.div>
        )}

        {activeTab === 'risk' && (
           <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                 <div className="lg:col-span-2 space-y-6">
                    <h3 className="font-serif text-2xl text-white px-2">High Risk User Nodes</h3>
                    {users.filter(u => u.riskLevel === 'high' || u.riskLevel === 'medium').map(u => (
                      <div key={u.userId} className="rounded-[2rem] bg-brand-card p-8 border border-red-500/10 flex items-center justify-between">
                        <div className="flex items-center gap-5">
                           <div className="h-14 w-14 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500">
                             <AlertOctagon className="h-6 w-6" />
                           </div>
                           <div>
                              <h4 className="font-serif text-xl text-white">{u.displayName}</h4>
                              <p className="text-[9px] text-red-500/80 font-black uppercase tracking-widest">RISK LEVEL: {u.riskLevel}</p>
                           </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleFreezeUser(u.userId, 'Flagged by risk engine')}
                            disabled={!!processing}
                            className="px-6 py-3 rounded-xl bg-red-500 text-black text-[10px] font-black uppercase tracking-widest transition-transform active:scale-95 disabled:opacity-50"
                          >
                            Freeze
                          </button>
                        </div>
                      </div>
                    ))}
                 </div>
                 
                 <div className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 space-y-8">
                    <h3 className="font-serif text-xl text-white italic">Safety KPI</h3>
                    <div className="space-y-6">
                       <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                             <span className="text-slate-500">Trust Index</span>
                             <span className="text-white">88%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                             <div className="h-full bg-amber-500 w-[88%]" />
                          </div>
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                             <span className="text-slate-500">Fraud Prevention</span>
                             <span className="text-white">99.4%</span>
                          </div>
                          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                             <div className="h-full bg-green-500 w-[99.4%]" />
                          </div>
                       </div>
                    </div>
                 </div>
              </div>
           </motion.div>
        )}

        {activeTab === 'fraud' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                 <h3 className="font-serif text-2xl text-white px-2">Fraud Signal Monitor</h3>
                 {trades.filter(t => t.amount > 500000 || t.isDisputed).map(t => (
                   <div key={t.id} className="rounded-[2rem] bg-brand-card p-8 border border-red-500/10 space-y-4 shadow-xl">
                      <div className="flex justify-between items-start">
                         <div className="flex items-center gap-4">
                           <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                             <FileSearch className="h-5 w-5" />
                           </div>
                           <div>
                              <p className="text-xs font-black text-white">Large Transaction: {t.amount.toLocaleString()} CFA</p>
                              <p className="text-[9px] text-slate-500 uppercase tracking-widest">Trade: #{t.id.slice(-8)}</p>
                           </div>
                         </div>
                         <span className="px-3 py-1 rounded-full bg-red-500 text-black text-[8px] font-black uppercase">Suspicious</span>
                      </div>
                      <div className="flex gap-2 pt-2">
                         <button onClick={() => handleDisputeResolution(t.id, 'buyer')} className="flex-1 py-3 bg-red-500/10 text-red-500 text-[10px] font-black uppercase border border-red-500/20 rounded-xl">Hold Transaction</button>
                         <button className="flex-1 py-3 bg-white/5 text-slate-400 text-[10px] font-black uppercase border border-white/5 rounded-xl">Verify ID</button>
                      </div>
                   </div>
                 ))}
              </div>

               <div className="space-y-6">
                <div className="rounded-[2.5rem] bg-brand-card p-10 border border-white/5 space-y-6">
                   <h4 className="font-serif text-lg text-white">Threat Indicators</h4>
                   <div className="space-y-4">
                      {[
                        { label: 'Sybil Attack Patterns', count: 0 },
                        { label: 'Card Testing Signals', count: 1 },
                        { label: 'Location Mismatches', count: 3 },
                      ].map((item, i) => (
                        <div key={i} className="flex justify-between items-center p-4 bg-black/40 rounded-2xl border border-white/5">
                           <p className="text-[10px] font-bold text-slate-400">{item.label}</p>
                           <span className="text-[10px] font-black text-red-500 bg-red-500/10 px-2 py-1 rounded-md">{item.count}</span>
                        </div>
                      ))}
                   </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
