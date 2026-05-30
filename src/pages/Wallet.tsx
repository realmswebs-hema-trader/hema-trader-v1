import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
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
  setWalletPin,
  startWalletTopup,
  verifyWalletTopup,
  withdrawFromWallet,
  type WalletOverview
} from '../services/walletService';

const WALLET_LOAD_TIMEOUT_MS = 15000;
const WALLET_REFRESH_INTERVAL_MS = 30000;

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
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;
  if (value._seconds) return value._seconds * 1000;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const isValidPin = (pin: string) => /^\d{4}$|^\d{6}$/.test(pin);

const creditTransactionTypes = new Set([
  'wallet_funding',
  'wallet_topup',
  'product_refund',
  'driver_payout',
  'escrow_release',
  'refund'
]);

const getTransactionDirection = (tx: any): 'credit' | 'debit' => {
  if (tx?.direction === 'credit' || tx?.direction === 'debit') {
    return tx.direction;
  }

  return creditTransactionTypes.has(tx?.type) ? 'credit' : 'debit';
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export default function Wallet() {
  const { user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  const [topupAmount, setTopupAmount] = useState('');
  const [topupPhone, setTopupPhone] = useState('');
  const [pendingTopup, setPendingTopup] = useState<any>(null);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawPin, setWithdrawPin] = useState('');

  const isLoadingWalletRef = useRef(false);
  const overviewRef = useRef<WalletOverview | null>(null);
  const mountedRef = useRef(true);
  const fundPanelRef = useRef<HTMLDivElement>(null);

  const wallet = overview?.wallet;
  const walletSecurity = overview?.walletSecurity;
  const currency = wallet?.currency || 'XAF';

  const hasFundedWallet =
    Number(wallet?.availableBalance || 0) > 0 ||
    Number(wallet?.escrowBalance || 0) > 0 ||
    Number(wallet?.pendingWithdrawalBalance || 0) > 0 ||
    Number(wallet?.totalEarned || 0) > 0;

  const needsPin = hasFundedWallet && !walletSecurity?.hasPin;

  const loadWallet = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!user) {
        overviewRef.current = null;
        setOverview(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (isLoadingWalletRef.current) return;

      const silent = Boolean(options.silent);

      isLoadingWalletRef.current = true;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setLoadError('');

      try {
        const data = await withTimeout(
          getWalletOverview(user),
          WALLET_LOAD_TIMEOUT_MS,
          'Wallet is taking too long to load. Please check your connection and try again.'
        );

        if (!mountedRef.current) return;

        overviewRef.current = data;
        setOverview(data);
        setLoadError('');
      } catch (err) {
        console.error('Wallet load failed:', err);

        if (!mountedRef.current) return;

        const nextMessage =
          err instanceof Error ? err.message : 'Could not load wallet. Please try again.';

        setLoadError(nextMessage);

        if (!overviewRef.current) {
          setMessage(nextMessage);
        }
      } finally {
        isLoadingWalletRef.current = false;

        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [user]
  );

  useEffect(() => {
    mountedRef.current = true;

    if (!user) {
      overviewRef.current = null;
      setOverview(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    void loadWallet();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadWallet({ silent: true });
      }
    }, WALLET_REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [user, loadWallet]);

  useEffect(() => {
    if (searchParams.get('fund') !== '1') return;

    setMessage('Funding panel is ready. Enter your amount and Mobile Money number below.');

    window.setTimeout(() => {
      fundPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 250);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('fund');

    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const chartData = useMemo(() => {
    const txs = [...(overview?.transactions || [])]
      .sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt))
      .slice(-12);

    let balance = 0;

    return txs.map(tx => {
      const amount = Number(tx.amount || 0);
      balance += getTransactionDirection(tx) === 'credit' ? amount : -amount;

      return {
        name: tx.type?.replaceAll('_', ' ') || 'tx',
        balance: Math.max(balance, 0)
      };
    });
  }, [overview]);

  const handleTopup = async () => {
    if (!user) return;

    const amount = Number(topupAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a valid top-up amount.');
      return;
    }

    if (!topupPhone.trim()) {
      setMessage('Enter your MTN or Orange Money number.');
      return;
    }

    setWorking(true);
    setMessage('');

    try {
      const result = await startWalletTopup(user, {
        amount,
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

      const paymentStatus = String(result.status || '').toUpperCase();

      if (paymentStatus === 'PENDING' || paymentStatus === 'PROCESSING') {
        setMessage('Payment is still pending. Confirm on your phone, then try again.');
      } else {
        setMessage('Wallet funded successfully. Create your transaction PIN to secure transfers.');
        setPendingTopup(null);
        setTopupAmount('');
        setTopupPhone('');
        await loadWallet({ silent: true });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setWorking(false);
    }
  };

  const handleCreatePin = async () => {
    if (!user) return;

    if (!isValidPin(pin)) {
      setMessage('PIN must be 4 or 6 digits.');
      return;
    }

    if (pin !== confirmPin) {
      setMessage('PIN confirmation does not match.');
      return;
    }

    setWorking(true);
    setMessage('');

    try {
      await setWalletPin(user, {
        pin,
        confirmPin
      });

      setPin('');
      setConfirmPin('');
      setMessage('Transaction PIN created. Your Hema Wallet is now secured.');
      await loadWallet({ silent: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create PIN.');
    } finally {
      setWorking(false);
    }
  };

  const handleWithdraw = async () => {
    if (!user) return;

    const amount = Number(withdrawAmount);

    if (!walletSecurity?.hasPin) {
      setMessage('Create your transaction PIN before withdrawing.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a valid withdrawal amount.');
      return;
    }

    if (!withdrawPhone.trim()) {
      setMessage('Enter your MTN or Orange Money payout number.');
      return;
    }

    if (!isValidPin(withdrawPin)) {
      setMessage('Enter your 4 or 6 digit Wallet PIN to withdraw.');
      return;
    }

    setWorking(true);
    setMessage('');

    try {
      await withdrawFromWallet(user, {
        amount,
        phoneNumber: withdrawPhone,
        walletPin: withdrawPin,
        method: 'mobile_money',
        currency
      });

      setMessage('Withdrawal submitted.');
      setWithdrawAmount('');
      setWithdrawPhone('');
      setWithdrawPin('');
      await loadWallet({ silent: true });
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

  if (loadError && !overview) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-red-500/20 bg-red-500/10 p-10 text-center">
        <AlertCircle className="mx-auto mb-5 h-10 w-10 text-red-400" />
        <h1 className="font-serif text-2xl text-white">Wallet could not load</h1>
        <p className="mt-3 text-sm leading-relaxed text-red-100/80">
          {loadError}
        </p>
        <button
          onClick={() => loadWallet()}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-[10px] font-black uppercase tracking-widest text-black"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
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
              onClick={() => loadWallet({ silent: Boolean(overview) })}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
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

      {(message || (loadError && overview)) && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {message || loadError}
        </div>
      )}

      {needsPin && (
        <section className="rounded-[2rem] border border-amber-500/20 bg-amber-500/10 p-6 shadow-2xl">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            <div>
              <h2 className="font-serif text-2xl text-white">
                Create Your Transaction PIN
              </h2>
              <p className="mt-1 text-sm text-amber-100/70">
                Your wallet has funds. Create a 4 or 6 digit PIN before paying sellers, drivers, or withdrawing.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={event => setPin(event.target.value.replace(/\D/g, ''))}
              placeholder="New PIN"
              className="rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={event => setConfirmPin(event.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />
            <button
              onClick={handleCreatePin}
              disabled={working || !pin || !confirmPin}
              className="rounded-xl bg-amber-500 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
            >
              Secure Wallet
            </button>
          </div>
        </section>
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
            {(overview?.transactions || []).slice(0, 8).map(tx => {
              const direction = getTransactionDirection(tx);

              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/30 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2 ${
                      direction === 'credit'
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      {direction === 'credit' ? (
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
                    {direction === 'credit' ? '+' : '-'}
                    {formatMoney(Number(tx.amount || 0), tx.currency || currency)}
                  </p>
                </div>
              );
            })}

            {(overview?.transactions || []).length === 0 && (
              <div className="rounded-2xl border border-white/5 bg-black/30 p-6 text-center text-sm text-slate-500">
                No wallet transactions yet.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <div
            ref={fundPanelRef}
            className="rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl"
          >
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
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={withdrawPin}
                onChange={event => setWithdrawPin(event.target.value.replace(/\D/g, ''))}
                placeholder="Wallet PIN"
                className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />

              <button
                onClick={handleWithdraw}
                disabled={working || !withdrawAmount || !withdrawPhone || !withdrawPin}
                className="w-full rounded-xl bg-white py-4 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
              >
                Withdraw To Mobile Money
              </button>

              {!walletSecurity?.hasPin && (
                <p className="text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
                  Create your transaction PIN before withdrawing.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
