import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { useAuth } from '../components/auth/AuthContext';
import {
  getWalletOverview,
  startWalletTopup,
  verifyWalletTopup,
  withdrawFromWallet,
  type WalletOverview
} from '../services/walletService';

const formatMoney = (amount = 0, currency = 'XAF') => {
  try {
    return new Intl.NumberFormat('fr-CM', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'XAF' ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
};

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
};

export default function Wallet() {
  const { user, profile } = useAuth();

  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  const [topupAmount, setTopupAmount] = useState('');
  const [topupPhone, setTopupPhone] = useState('');
  const [pendingTopup, setPendingTopup] = useState<any>(null);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');

  const wallet = overview?.wallet;
  const currency = wallet?.currency || 'XAF';

  const loadWallet = async () => {
    if (!user) return;

    setLoading(true);

    try {
      const data = await getWalletOverview(user);
      setOverview(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load wallet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWallet();

    const timer = window.setInterval(() => {
      loadWallet();
    }, 10000);

    return () => window.clearInterval(timer);
  }, [user]);

  const chartData = useMemo(() => {
    const txs = [...(overview?.transactions || [])]
      .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt))
      .slice(-12);

    let balance = 0;

    return txs.map(tx => {
      const amount = Number(tx.amount || 0);
      balance += tx.direction === 'credit' ? amount : -amount;

      return {
        name: tx.type?.replaceAll('_', ' ') || 'tx',
        balance: Math.max(balance, 0)
      };
    });
  }, [overview]);

  const handleTopup = async () => {
    if (!user) return;

    setWorking(true);
    setMessage('');

    try {
      const result = await startWalletTopup(user, {
        amount: Number(topupAmount),
        phoneNumber: topupPhone,
        currency
      });

      setPendingTopup(result);
      setMessage(
        result.ussdCode
          ? `Payment request sent. Confirm on your phone or dial ${result.ussdCode}.`
          : 'Payment request sent. Confirm on your phone, then verify.'
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Top-up failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleVerifyTopup = async () => {
    if (!user || !pendingTopup) return;

    setWorking(true);
    setMessage('');

    try {
      const result = await verifyWalletTopup(user, {
        txRef: pendingTopup.txRef,
        providerReference: pendingTopup.providerReference
      });

      if (result.status === 'PENDING') {
        setMessage('Payment is still pending. Confirm on your phone, then try again.');
      } else {
        setMessage('Wallet funded successfully.');
        setPendingTopup(null);
        setTopupAmount('');
        await loadWallet();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleWithdraw = async () => {
    if (!user) return;

    setWorking(true);
    setMessage('');

    try {
      await withdrawFromWallet(user, {
        amount: Number(withdrawAmount),
        phoneNumber: withdrawPhone,
        method: 'mobile_money',
        currency
      });

      setMessage('Withdrawal submitted.');
      setWithdrawAmount('');
      await loadWallet();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Withdrawal failed.');
    } finally {
      setWorking(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center">
        <WalletCards className="mx-auto mb-5 h-10 w-10 text-amber-500" />
        <h1 className="font-serif text-2xl text-white">Sign in required</h1>
      </div>
    );
  }

  if (loading && !overview) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl">
        <div className="border-b border-white/5 bg-black/30 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-500">
                Hema Wallet
              </p>
              <h1 className="mt-2 font-serif text-4xl text-white">
                {profile?.displayName || profile?.name || 'Your'} Financial Hub
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Fund, escrow, earn, and withdraw through protected Hema Trader balances.
              </p>
            </div>

            <button
              onClick={loadWallet}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-px bg-white/5 md:grid-cols-3">
          <div className="bg-brand-card p-6">
            <div className="flex items-center gap-3 text-green-400">
              <WalletCards className="h-5 w-5" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Available
              </p>
            </div>
            <p className="mt-4 text-3xl font-black text-white">
              {formatMoney(wallet?.availableBalance || 0, currency)}
            </p>
          </div>

          <div className="bg-brand-card p-6">
            <div className="flex items-center gap-3 text-amber-500">
              <LockKeyhole className="h-5 w-5" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                In Escrow
              </p>
            </div>
            <p className="mt-4 text-3xl font-black text-white">
              {formatMoney(wallet?.escrowBalance || 0, currency)}
            </p>
          </div>

          <div className="bg-brand-card p-6">
            <div className="flex items-center gap-3 text-blue-400">
              <Clock className="h-5 w-5" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Pending Withdrawal
              </p>
            </div>
            <p className="mt-4 text-3xl font-black text-white">
              {formatMoney(wallet?.pendingWithdrawalBalance || 0, currency)}
            </p>
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            <h2 className="font-serif text-2xl text-white">Balance Movement</h2>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="walletGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: '#09090b',
                    border: '1px solid rgba(255,255,255,.1)',
                    borderRadius: '12px',
                    color: 'white'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#f59e0b"
                  fill="url(#walletGlow)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-6 space-y-3">
            {(overview?.transactions || []).slice(0, 8).map(tx => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/30 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-2 ${
                    tx.direction === 'credit'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {tx.direction === 'credit' ? (
                      <ArrowDownToLine className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wider text-white">
                      {tx.type?.replaceAll('_', ' ') || 'Transaction'}
                    </p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-600">
                      {tx.status || 'completed'}
                    </p>
                  </div>
                </div>

                <p className="text-sm font-black text-white">
                  {tx.direction === 'credit' ? '+' : '-'}
                  {formatMoney(Number(tx.amount || 0), tx.currency || currency)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-green-400" />
              <h3 className="font-serif text-xl text-white">Fund Wallet</h3>
            </div>

            <div className="space-y-3">
              <input
                type="number"
                value={topupAmount}
                onChange={event => setTopupAmount(event.target.value)}
                placeholder="Amount in XAF"
                className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />
              <input
                value={topupPhone}
                onChange={event => setTopupPhone(event.target.value)}
                placeholder="MTN/Orange number e.g. 2376..."
                className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />

              <button
                onClick={handleTopup}
                disabled={working || !topupAmount || !topupPhone}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Request MoMo Payment
              </button>

              {pendingTopup && (
                <button
                  onClick={handleVerifyTopup}
                  disabled={working}
                  className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-4 text-[10px] font-black uppercase tracking-widest text-amber-400 disabled:opacity-50"
                >
                  I Confirmed Payment
                </button>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <Banknote className="h-5 w-5 text-amber-500" />
              <h3 className="font-serif text-xl text-white">Withdraw</h3>
            </div>

            <div className="space-y-3">
              <input
                type="number"
                value={withdrawAmount}
                onChange={event => setWithdrawAmount(event.target.value)}
                placeholder="Amount in XAF"
                className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />
              <input
                value={withdrawPhone}
                onChange={event => setWithdrawPhone(event.target.value)}
                placeholder="MTN/Orange payout number"
                className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />

              <button
                onClick={handleWithdraw}
                disabled={working || !withdrawAmount || !withdrawPhone}
                className="w-full rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                Withdraw To Mobile Money
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
