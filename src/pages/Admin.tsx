import { useEffect, useMemo, useState } from 'react';
import {
  arrayUnion,
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type Query,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  Banknote,
  BarChart3,
  Clock,
  CreditCard,
  DollarSign,
  FileSearch,
  Gavel,
  HeartPulse,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
  WalletCards
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { useAuth } from '../components/auth/AuthContext';
import { REVENUE_CONFIG } from '../config/revenueConfig';
import { db } from '../lib/firebase';

const ADMIN_EMAIL = 'realmswebs@gmail.com';
const DEFAULT_MODERATOR_EMAIL = 'realmscity@gmail.com';
const PAGE_SIZE = 20;
const CHART_COLORS = ['#f59e0b', '#22c55e', '#38bdf8', '#a855f7', '#f97316', '#ef4444'];

type AdminTab =
  | 'ops'
  | 'users'
  | 'moderators'
  | 'disputes'
  | 'risk'
  | 'fraud'
  | 'revenue';
type RevenueKind =
  | 'trade_fee'
  | 'delivery_commission'
  | 'subscription'
  | 'boost'
  | 'verification'
  | 'withdrawal_fee'
  | 'other';

interface UserProfile {
  userId: string;
  uid?: string;
  displayName?: string;
  name?: string;
  email?: string;
  verificationStatus?: string;
  warningCount?: number;
  isBanned?: boolean;
  isSuspended?: boolean;
  roles?: string[];
  riskLevel?: 'none' | 'low' | 'medium' | 'high';
  reliabilityScore?: number;
  deliveriesCount?: number;
  badges?: string[];
  sellerTier?: 'none' | 'elite' | 'trusted' | 'official';
  driverTier?: 'none' | 'trusted' | 'master';
  totalTrades?: number;
  averageRating?: number;
  phoneNumber?: string;
  location?: string;
  city?: string;
  isModerator?: boolean;
  moderatorVerified?: boolean;
  moderatorStatus?: 'pending_review' | 'approved' | 'rejected' | 'suspended';
  moderatorApplicationStatus?: 'pending_review' | 'approved' | 'rejected' | 'suspended';
  moderatorAvailability?: 'available' | 'busy' | 'offline';
  moderatorCity?: string;
  moderatorRegions?: string[];
  moderatorRoutes?: string[];
  moderatorTransportCapacity?: string;
  moderatorRating?: number;
  completedModeratorDeliveries?: number;
  moderatorWalletBalance?: number;
  moderatorCanWithdrawImmediately?: boolean;
  subscription?: {
    plan?: 'free' | 'starter' | 'pro' | 'business';
    status?: 'active' | 'expired' | 'cancelled';
    paymentStatus?: 'paid' | 'unpaid' | 'trial';
    startedAt?: any;
    expiresAt?: any;
  };
}

interface Trade {
  id: string;
  buyerId?: string;
  sellerId?: string;
  driverId?: string;
  amount?: number;
  status?: string;
  isDisputed?: boolean;
  disputeStatus?: string;
  platformFee?: number;
  deliveryFee?: number;
  driverCommission?: number;
  sellerPayout?: number;
  escrowStatus?: string;
  paymentStatus?: string;
  createdAt?: any;
  updatedAt?: any;
  lastActivityAt?: any;
}

interface Report {
  id: string;
  reporterId?: string;
  targetId?: string;
  reason?: string;
  description?: string;
  status?: string;
  adminNote?: string;
  createdAt?: any;
}

interface PlatformRevenueRecord {
  id: string;
  type?: string;
  category?: string;
  source?: string;
  amount?: number;
  platformAmount?: number;
  fee?: number;
  amountPaid?: number;
  currency?: string;
  status?: string;
  tradeId?: string;
  sellerId?: string;
  driverId?: string;
  userId?: string;
  createdAt?: any;
  metadata?: Record<string, any>;
}

interface PayoutRequest {
  id: string;
  userId?: string;
  role?: 'seller' | 'driver' | 'buyer';
  type?: string;
  amount?: number;
  grossAmount?: number;
  fee?: number;
  withdrawalFee?: number;
  netAmount?: number;
  status?: 'pending' | 'processing' | 'paid' | 'rejected' | 'cancelled';
  createdAt?: any;
}

interface SubscriptionRecord {
  id: string;
  userId?: string;
  plan?: 'free' | 'starter' | 'pro' | 'business';
  role?: 'buyer' | 'seller' | 'driver';
  status?: 'active' | 'expired' | 'cancelled';
  paymentStatus?: 'paid' | 'unpaid' | 'trial';
  amount?: number;
  amountPaid?: number;
  createdAt?: any;
}

interface BoostRecord {
  id: string;
  listingId?: string;
  sellerId?: string;
  boostType?: 'oneDay' | 'threeDays' | 'sevenDays' | 'homepage';
  amountPaid?: number;
  status?: string;
  createdAt?: any;
}

interface VerificationRequest {
  id: string;
  userId?: string;
  type?: 'seller' | 'driver' | 'business';
  status?: 'pending' | 'approved' | 'rejected';
  paymentStatus?: 'paid' | 'unpaid';
  amountPaid?: number;
  createdAt?: any;
}

interface ModeratorApplication {
  id: string;
  userId: string;
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  cityOrRegion?: string;
  routes?: string[];
  transportCapacity?: string;
  identityDocumentUrl?: string;
  status?: 'pending_review' | 'approved' | 'rejected' | 'suspended';
  reviewedBy?: string;
  reviewedAt?: any;
  rejectionReason?: string;
  createdAt?: any;
  updatedAt?: any;
}

interface SystemHealth {
  stuckTrades: number;
  openReports: number;
  avgResolutionTime: string;
  systemLoad: 'optimal' | 'high' | 'critical';
}

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const formatMoney = (amount = 0, currency = REVENUE_CONFIG.currency || 'XAF') => {
  try {
    return new Intl.NumberFormat('fr-CM', {
      style: 'currency',
      currency,
      maximumFractionDigits: ['XAF', 'XOF', 'UGX', 'RWF'].includes(currency) ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
};

const normalizeRevenueKind = (record: PlatformRevenueRecord): RevenueKind => {
  const raw = `${record.type || record.category || record.source || ''}`.toLowerCase();

  if (raw.includes('delivery')) return 'delivery_commission';
  if (raw.includes('subscription')) return 'subscription';
  if (raw.includes('boost')) return 'boost';
  if (raw.includes('verification')) return 'verification';
  if (raw.includes('withdraw')) return 'withdrawal_fee';
  if (raw.includes('trade') || raw.includes('platform') || raw.includes('escrow')) return 'trade_fee';

  return 'other';
};

const getRevenueAmount = (record: PlatformRevenueRecord) =>
  safeNumber(record.amount ?? record.platformAmount ?? record.fee ?? record.amountPaid);

const getSubscriptionPrice = (plan?: string) => {
  const subscriptions = REVENUE_CONFIG.subscriptions as any;

  switch (plan) {
    case 'starter':
      return subscriptions.sellerStarter ?? subscriptions.starter ?? 2500;
    case 'pro':
      return subscriptions.sellerPro ?? subscriptions.pro ?? 7500;
    case 'business':
      return subscriptions.sellerBusiness ?? subscriptions.business ?? 20000;
    default:
      return 0;
  }
};

const getDisplayName = (user: UserProfile) =>
  user.displayName || user.name || user.email || `User ${user.userId?.slice(-6) || ''}`;

export default function Admin() {
  const { user: authUser, profile, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('ops');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<PlatformRevenueRecord[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [boosts, setBoosts] = useState<BoostRecord[]>([]);
  const [verifications, setVerifications] = useState<VerificationRequest[]>([]);
  const [moderatorApplications, setModeratorApplications] = useState<ModeratorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const isAdmin =
    authUser?.email?.toLowerCase() === ADMIN_EMAIL ||
    profile?.roles?.includes('admin') ||
    profile?.admin === true;

  useEffect(() => {
    setLastDoc(null);
    setUsers([]);
    setTrades([]);
    setReports([]);
    setModeratorApplications([]);
    void fetchData(false);
  }, [activeTab, authUser?.uid, isAdmin]);

  const readQuery = async <T,>(
    request: Query,
    mapper: (docSnap: QueryDocumentSnapshot) => T,
    label: string
  ): Promise<T[]> => {
    try {
      const snap = await getDocs(request);
      return snap.docs.map(mapper);
    } catch (error) {
      console.error(`${label} fetch failed:`, error);
      return [];
    }
  };

  const fetchRevenueData = async () => {
    const [nextRevenue, nextPayouts, nextSubscriptions, nextBoosts, nextVerifications] =
      await Promise.all([
        readQuery(
          query(collection(db, 'platformRevenue'), orderBy('createdAt', 'desc'), limit(300)),
          d => ({ id: d.id, ...d.data() } as PlatformRevenueRecord),
          'Platform revenue'
        ),
        readQuery(
          query(collection(db, 'payouts'), orderBy('createdAt', 'desc'), limit(150)),
          d => ({ id: d.id, ...d.data() } as PayoutRequest),
          'Payouts'
        ),
        readQuery(
          query(collection(db, 'subscriptions'), orderBy('createdAt', 'desc'), limit(150)),
          d => ({ id: d.id, ...d.data() } as SubscriptionRecord),
          'Subscriptions'
        ),
        readQuery(
          query(collection(db, 'boosts'), orderBy('createdAt', 'desc'), limit(150)),
          d => ({ id: d.id, ...d.data() } as BoostRecord),
          'Boosts'
        ),
        readQuery(
          query(collection(db, 'verifications'), orderBy('createdAt', 'desc'), limit(150)),
          d => ({ id: d.id, ...d.data() } as VerificationRequest),
          'Verifications'
        )
      ]);

    setRevenueRecords(nextRevenue);
    setPayouts(nextPayouts);
    setSubscriptions(nextSubscriptions);
    setBoosts(nextBoosts);
    setVerifications(nextVerifications);
  };

  const fetchData = async (isMore = false) => {
    if (!authUser || !isAdmin) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      if (activeTab === 'ops' || activeTab === 'revenue' || activeTab === 'fraud') {
        const [nextTrades, nextUsers, nextReports] = await Promise.all([
          readQuery(
            query(collection(db, 'trades'), orderBy('createdAt', 'desc'), limit(150)),
            d => ({ id: d.id, ...d.data() } as Trade),
            'Trades'
          ),
          readQuery(
            query(collection(db, 'users'), limit(150)),
            d => ({ userId: d.id, ...d.data() } as UserProfile),
            'Users'
          ),
          readQuery(
            query(collection(db, 'reports'), where('status', '==', 'pending'), limit(75)),
            d => ({ id: d.id, ...d.data() } as Report),
            'Reports'
          )
        ]);

        setTrades(nextTrades);
        setUsers(nextUsers);
        setReports(nextReports);

        if (activeTab === 'revenue') {
          await fetchRevenueData();
        }
      } else if (activeTab === 'users') {
        let userQuery = query(collection(db, 'users'), orderBy('displayName'), limit(PAGE_SIZE));

        if (isMore && lastDoc) {
          userQuery = query(
            collection(db, 'users'),
            orderBy('displayName'),
            startAfter(lastDoc),
            limit(PAGE_SIZE)
          );
        }

        const snap = await getDocs(userQuery);
        const newUsers = snap.docs.map(
          d => ({ userId: d.id, ...d.data() } as UserProfile)
        );

        setUsers(prev => (isMore ? [...prev, ...newUsers] : newUsers));
        setLastDoc(snap.docs[snap.docs.length - 1] || null);
        setHasMore(snap.docs.length === PAGE_SIZE);
      } else if (activeTab === 'disputes') {
        const nextTrades = await readQuery(
          query(
            collection(db, 'trades'),
            where('isDisputed', '==', true),
            orderBy('lastActivityAt', 'desc')
          ),
          d => ({ id: d.id, ...d.data() } as Trade),
          'Disputed trades'
        );

        setTrades(nextTrades);
      } else if (activeTab === 'risk') {
        const [nextUsers, nextReports] = await Promise.all([
          readQuery(
            query(collection(db, 'users'), where('riskLevel', 'in', ['medium', 'high'])),
            d => ({ userId: d.id, ...d.data() } as UserProfile),
            'Risk users'
          ),
          readQuery(
            query(collection(db, 'reports'), where('status', '==', 'pending')),
            d => ({ id: d.id, ...d.data() } as Report),
            'Pending reports'
          )
        ]);

        setUsers(nextUsers);
        setReports(nextReports);
      } else if (activeTab === 'moderators') {
        const [nextModerators, nextApplications] = await Promise.all([
          readQuery(
            query(collection(db, 'users'), where('roles', 'array-contains', 'moderator'), limit(200)),
            d => ({ userId: d.id, ...d.data() } as UserProfile),
            'Moderators'
          ),
          readQuery(
            query(collection(db, 'moderatorApplications'), limit(200)),
            d => ({ id: d.id, ...d.data() } as ModeratorApplication),
            'Moderator applications'
          )
        ]);

        setUsers(
          nextModerators.sort((a, b) => {
            const statusRank: Record<string, number> = {
              approved: 4,
              pending_review: 3,
              suspended: 2,
              rejected: 1
            };
            const statusDelta =
              (statusRank[b.moderatorStatus || ''] || 0) -
              (statusRank[a.moderatorStatus || ''] || 0);

            if (statusDelta !== 0) return statusDelta;

            return getDisplayName(a).localeCompare(getDisplayName(b));
          })
        );

        setModeratorApplications(
          nextApplications.sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt))
        );
      }
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const logAudit = async (
    action: string,
    targetId: string,
    reason: string,
    metadata: Record<string, any> = {}
  ) => {
    if (!authUser) return;

    try {
      await addDoc(collection(db, 'adminLogs'), {
        adminId: authUser.uid,
        adminEmail: authUser.email || '',
        action,
        targetId,
        reason,
        metadata,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Admin log failed:', e);
    }
  };

  const handleFreezeUser = async (userId: string, reason: string) => {
    setProcessing(userId);

    try {
      await updateDoc(doc(db, 'users', userId), {
        isSuspended: true,
        riskLevel: 'high',
        riskFlags: ['Manually suspended by admin'],
        updatedAt: serverTimestamp()
      });

      await logAudit('ACCOUNT_FREEZE', userId, reason);
      alert('Account frozen successfully.');
      void fetchData(false);
    } catch (err) {
      console.error('Freeze failed:', err);
      alert('Freeze failed.');
    } finally {
      setProcessing(null);
    }
  };

  const syncUserTiers = async () => {
    setProcessing('sync_tiers');

    try {
      const snap = await getDocs(collection(db, 'users'));
      let processed = 0;

      for (const userDoc of snap.docs) {
        const u = { userId: userDoc.id, ...userDoc.data() } as UserProfile;
        const updates: Record<string, any> = { updatedAt: serverTimestamp() };
        const badges: string[] = [];

        if (u.verificationStatus === 'verified') badges.push('Verified');

        let newSellerTier: UserProfile['sellerTier'] = 'none';
        if ((u.totalTrades || 0) > 50 && (u.averageRating || 0) > 4.7) {
          newSellerTier = 'elite';
          badges.push('Elite Seller');
        } else if ((u.totalTrades || 0) > 10) {
          newSellerTier = 'trusted';
          badges.push('Trusted');
        }

        let newDriverTier: UserProfile['driverTier'] = 'none';
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
        processed += 1;
      }

      await logAudit('USER_TIERS_SYNCED', 'users', `${processed} users audited.`);
      alert(`Sync complete: ${processed} users audited.`);
      void fetchData(false);
    } catch (err) {
      console.error('Sync failed:', err);
      alert('Tier synchronization failed.');
    } finally {
      setProcessing(null);
    }
  };

  const handleDisputeResolution = async (
    tradeId: string,
    resolution: 'buyer' | 'seller' | 'split'
  ) => {
    setProcessing(tradeId);

    try {
      await updateDoc(doc(db, 'trades', tradeId), {
        isDisputed: false,
        disputeStatus: 'resolved',
        disputeResolution: resolution,
        status: resolution === 'buyer' ? 'cancelled' : 'completed',
        updatedAt: serverTimestamp()
      });

      await logAudit('DISPUTE_RESOLVED', tradeId, `Resolution: ${resolution}`);
      void fetchData(false);
    } catch (err) {
      console.error('Dispute resolution failed:', err);
      alert('Dispute resolution failed.');
    } finally {
      setProcessing(null);
    }
  };

  const handleVerificationReview = async (
    request: VerificationRequest,
    status: 'approved' | 'rejected'
  ) => {
    if (!request.userId) return;

    setProcessing(`verification_${request.id}`);

    try {
      await updateDoc(doc(db, 'verifications', request.id), {
        status,
        reviewedBy: authUser?.uid || '',
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (status === 'approved') {
        const userUpdates: Record<string, any> = {
          verificationStatus: 'verified',
          updatedAt: serverTimestamp()
        };

        if (request.type === 'seller') userUpdates.sellerVerified = true;
        if (request.type === 'driver') userUpdates.driverVerified = true;
        if (request.type === 'business') userUpdates.businessVerified = true;

        await updateDoc(doc(db, 'users', request.userId), userUpdates);
      }

      await logAudit(
        status === 'approved' ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
        request.userId,
        `${request.type || 'user'} verification ${status}`,
        { verificationId: request.id }
      );

      void fetchRevenueData();
    } catch (error) {
      console.error('Verification review failed:', error);
      alert('Verification review failed.');
    } finally {
      setProcessing(null);
    }
  };

  const handlePayoutStatus = async (
    payout: PayoutRequest,
    status: 'processing' | 'paid' | 'rejected'
  ) => {
    setProcessing(`payout_${payout.id}`);

    try {
      await updateDoc(doc(db, 'payouts', payout.id), {
        status,
        reviewedBy: authUser?.uid || '',
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await logAudit('PAYOUT_STATUS_UPDATED', payout.id, `Payout marked ${status}`, {
        userId: payout.userId,
        amount: payout.amount
      });

      void fetchRevenueData();
    } catch (error) {
      console.error('Payout update failed:', error);
      alert('Payout update failed.');
    } finally {
      setProcessing(null);
    }
  };

  const handleModeratorApplicationReview = async (
    application: ModeratorApplication,
    status: 'approved' | 'rejected'
  ) => {
    if (!application.userId) return;

    setProcessing(`moderator_application_${application.id}`);

    try {
      const userUpdates: Record<string, any> = {
        moderatorApplicationStatus: status,
        moderatorStatus: status,
        updatedAt: serverTimestamp()
      };

      if (status === 'approved') {
        userUpdates.roles = arrayUnion('moderator');
        userUpdates.isModerator = true;
        userUpdates.moderatorVerified = true;
        userUpdates.moderatorStatus = 'approved';
        userUpdates.moderatorApplicationStatus = 'approved';
        userUpdates.moderatorAvailability = 'available';
        userUpdates.moderatorCity = application.cityOrRegion || '';
        userUpdates.moderatorRegions = application.cityOrRegion
          ? [application.cityOrRegion]
          : [];
        userUpdates.moderatorRoutes = application.routes || [];
        userUpdates.moderatorTransportCapacity =
          application.transportCapacity || 'Verified long-distance delivery support';
        userUpdates.moderatorCanWithdrawImmediately = true;
        userUpdates.moderatorApprovedAt = serverTimestamp();
        userUpdates.moderatorApprovedBy = authUser?.uid || '';
      }

      await updateDoc(doc(db, 'moderatorApplications', application.id), {
        status,
        reviewedBy: authUser?.uid || '',
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'users', application.userId), userUpdates);

      await logAudit(
        status === 'approved' ? 'MODERATOR_APPROVED' : 'MODERATOR_REJECTED',
        application.userId,
        `Moderator application ${status}`,
        { applicationId: application.id }
      );

      void fetchData(false);
    } catch (error) {
      console.error('Moderator review failed:', error);
      alert('Moderator review failed.');
    } finally {
      setProcessing(null);
    }
  };

  const handleModeratorStatus = async (
    moderator: UserProfile,
    status: 'approved' | 'suspended'
  ) => {
    setProcessing(`moderator_${moderator.userId}`);

    try {
      await updateDoc(doc(db, 'users', moderator.userId), {
        roles: arrayUnion('moderator'),
        isModerator: status === 'approved',
        moderatorVerified: status === 'approved',
        moderatorStatus: status,
        moderatorApplicationStatus: status,
        moderatorAvailability: status === 'approved' ? 'available' : 'offline',
        moderatorCanWithdrawImmediately: status === 'approved',
        updatedAt: serverTimestamp(),
        ...(status === 'approved'
          ? {
              moderatorApprovedAt: serverTimestamp(),
              moderatorApprovedBy: authUser?.uid || ''
            }
          : {
              moderatorSuspendedAt: serverTimestamp(),
              moderatorSuspendedBy: authUser?.uid || ''
            })
      });

      await logAudit(
        status === 'approved' ? 'MODERATOR_RESTORED' : 'MODERATOR_SUSPENDED',
        moderator.userId,
        `Moderator marked ${status}`,
        { email: moderator.email || '' }
      );

      void fetchData(false);
    } catch (error) {
      console.error('Moderator status update failed:', error);
      alert('Moderator status update failed.');
    } finally {
      setProcessing(null);
    }
  };

  const seedDefaultModerator = async () => {
    setProcessing('seed_default_moderator');

    try {
      const defaultModeratorSnap = await getDocs(
        query(collection(db, 'users'), where('email', '==', DEFAULT_MODERATOR_EMAIL), limit(1))
      );

      if (defaultModeratorSnap.empty) {
        alert(
          `${DEFAULT_MODERATOR_EMAIL} must sign in once before admin can verify the account as a moderator.`
        );
        return;
      }

      const defaultModeratorDoc = defaultModeratorSnap.docs[0];

      await updateDoc(doc(db, 'users', defaultModeratorDoc.id), {
        roles: arrayUnion('moderator', 'buyer', 'seller'),
        isModerator: true,
        moderatorVerified: true,
        moderatorStatus: 'approved',
        moderatorApplicationStatus: 'approved',
        moderatorAvailability: 'available',
        moderatorCity: 'Cameroon',
        moderatorRegions: ['Douala', 'Bamenda', 'Bafoussam', 'Yaounde'],
        moderatorRoutes: [
          'Douala-Bamenda',
          'Douala-Bafoussam',
          'Douala-Yaounde',
          'Bamenda-Bafoussam',
          'Yaounde-Bafoussam'
        ],
        moderatorTransportCapacity:
          'Verified Hema Moderator for long-distance marketplace delivery coordination.',
        moderatorCanWithdrawImmediately: true,
        moderatorApprovedAt: serverTimestamp(),
        moderatorApprovedBy: authUser?.uid || '',
        updatedAt: serverTimestamp()
      });

      await logAudit(
        'DEFAULT_MODERATOR_SEEDED',
        defaultModeratorDoc.id,
        `${DEFAULT_MODERATOR_EMAIL} verified as moderator`
      );

      alert(`${DEFAULT_MODERATOR_EMAIL} is now a verified Hema Moderator.`);
      void fetchData(false);
    } catch (error) {
      console.error('Default moderator seed failed:', error);
      alert('Could not verify default moderator.');
    } finally {
      setProcessing(null);
    }
  };

  const revenueSummary = useMemo(() => {
    const byType: Record<RevenueKind, number> = {
      trade_fee: 0,
      delivery_commission: 0,
      subscription: 0,
      boost: 0,
      verification: 0,
      withdrawal_fee: 0,
      other: 0
    };

    revenueRecords.forEach(record => {
      byType[normalizeRevenueKind(record)] += getRevenueAmount(record);
    });

    const completedTrades = trades.filter(t => t.status === 'completed');
    const fallbackTradeFees = completedTrades.reduce(
      (sum, trade) => sum + safeNumber(trade.platformFee),
      0
    );
    const fallbackDelivery = completedTrades.reduce((sum, trade) => {
      const deliveryFee = safeNumber(trade.deliveryFee);
      const driverCommission = safeNumber(trade.driverCommission);
      const platformCommission =
        driverCommission > 0
          ? Math.max(deliveryFee - driverCommission, 0)
          : deliveryFee * REVENUE_CONFIG.deliveryCommission.platformRate;

      return sum + platformCommission;
    }, 0);
    const fallbackSubscriptions = subscriptions.reduce(
      (sum, item) =>
        sum +
        safeNumber(item.amountPaid ?? item.amount ?? getSubscriptionPrice(item.plan)),
      0
    );
    const fallbackBoosts = boosts.reduce(
      (sum, boost) => sum + safeNumber(boost.amountPaid),
      0
    );
    const fallbackVerification = verifications.reduce(
      (sum, item) => sum + safeNumber(item.amountPaid),
      0
    );
    const fallbackWithdrawalFees = payouts.reduce(
      (sum, payout) => sum + safeNumber(payout.fee ?? payout.withdrawalFee),
      0
    );

    const tradeFees = byType.trade_fee || fallbackTradeFees;
    const deliveryCommissions = byType.delivery_commission || fallbackDelivery;
    const subscriptionRevenue = byType.subscription || fallbackSubscriptions;
    const boostRevenue = byType.boost || fallbackBoosts;
    const verificationRevenue = byType.verification || fallbackVerification;
    const withdrawalFees = byType.withdrawal_fee || fallbackWithdrawalFees;
    const otherRevenue = byType.other;
    const totalPlatformRevenue =
      tradeFees +
      deliveryCommissions +
      subscriptionRevenue +
      boostRevenue +
      verificationRevenue +
      withdrawalFees +
      otherRevenue;

    const pendingEscrowBalance = trades
      .filter(
        trade =>
          !['completed', 'cancelled'].includes(trade.status || '') &&
          (trade.escrowStatus === 'funded' ||
            trade.paymentStatus === 'paid' ||
            ['funded', 'shipped', 'disputed'].includes(trade.status || ''))
      )
      .reduce((sum, trade) => sum + safeNumber(trade.amount), 0);

    const sellerPayouts = payouts
      .filter(payout => payout.role === 'seller' || payout.type === 'seller_payout')
      .reduce(
        (sum, payout) =>
          sum + safeNumber(payout.netAmount ?? payout.amount ?? payout.grossAmount),
        0
      );

    const driverPayouts = payouts
      .filter(payout => payout.role === 'driver' || payout.type === 'driver_payout')
      .reduce(
        (sum, payout) =>
          sum + safeNumber(payout.netAmount ?? payout.amount ?? payout.grossAmount),
        0
      );

    const activeSubscriptions = users.filter(
      user =>
        user.subscription?.status === 'active' &&
        user.subscription?.paymentStatus === 'paid'
    );

    const monthlyRecurringRevenue = activeSubscriptions.reduce(
      (sum, user) => sum + getSubscriptionPrice(user.subscription?.plan),
      0
    );

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartMillis = monthStart.getTime();
    const currentMonthRevenue = revenueRecords
      .filter(record => getMillis(record.createdAt) >= monthStartMillis)
      .reduce((sum, record) => sum + getRevenueAmount(record), 0);

    const topSellers = Array.from(
      completedTrades.reduce((map, trade) => {
        const sellerId = trade.sellerId || 'unknown';
        const current = map.get(sellerId) || { sellerId, volume: 0, trades: 0 };
        current.volume += safeNumber(trade.amount);
        current.trades += 1;
        map.set(sellerId, current);
        return map;
      }, new Map<string, { sellerId: string; volume: number; trades: number }>())
    )
      .map(([, seller]) => {
        const sellerProfile = users.find(user => user.userId === seller.sellerId);
        return {
          ...seller,
          name: sellerProfile ? getDisplayName(sellerProfile) : `Seller ${seller.sellerId.slice(-6)}`
        };
      })
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    const categories = [
      { name: 'Trade Fees', value: tradeFees },
      { name: 'Delivery', value: deliveryCommissions },
      { name: 'Subscriptions', value: subscriptionRevenue },
      { name: 'Boosts', value: boostRevenue },
      { name: 'Verification', value: verificationRevenue },
      { name: 'Withdrawals', value: withdrawalFees }
    ].filter(item => item.value > 0);

    return {
      totalPlatformRevenue,
      tradeFees,
      deliveryCommissions,
      subscriptionRevenue,
      boostRevenue,
      verificationRevenue,
      withdrawalFees,
      otherRevenue,
      pendingEscrowBalance,
      sellerPayouts,
      driverPayouts,
      monthlyRecurringRevenue,
      currentMonthRevenue,
      topSellers,
      categories
    };
  }, [boosts, payouts, revenueRecords, subscriptions, trades, users, verifications]);

  const platformHealth = useMemo((): SystemHealth => {
    const now = Date.now();
    const stuckTrades = trades.filter(t => {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      const lastActive = getMillis(t.lastActivityAt) || getMillis(t.updatedAt) || getMillis(t.createdAt);
      return lastActive > 0 && now - lastActive > 172800000;
    }).length;

    return {
      stuckTrades,
      openReports: reports.length,
      avgResolutionTime: '14.2h',
      systemLoad: stuckTrades > 20 ? 'critical' : stuckTrades > 10 ? 'high' : 'optimal'
    };
  }, [trades, reports]);

  const pendingVerifications = verifications.filter(item => item.status === 'pending');
  const pendingPayouts = payouts.filter(item => item.status === 'pending');

  if (authLoading || loading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Initializing Ops Hub...
        </p>
      </div>
    );
  }

  if (!authUser || !isAdmin) {
    return (
      <div className="mx-auto max-w-xl rounded-[2.5rem] border border-red-500/20 bg-red-500/10 p-10 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-red-400" />
        <h1 className="mt-5 font-serif text-3xl text-white">Admin Access Required</h1>
        <p className="mt-3 text-sm leading-relaxed text-red-100/80">
          This console is restricted to Hema Trader administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 pb-24 pt-8">
      <div className="flex flex-col gap-8 px-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 rounded-full bg-amber-500" />
            <h1 className="font-serif text-5xl tracking-tighter text-white">
              Ops Console
            </h1>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">
            Marketplace Integrity, Revenue, and Logistics Surveillance
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/5 bg-black/40 p-1.5 backdrop-blur-xl">
          {[
            { id: 'ops', icon: Activity, label: 'Overview' },
            { id: 'users', icon: Users, label: 'Users' },
            { id: 'moderators', icon: BadgeCheck, label: 'Moderators' },
            { id: 'disputes', icon: Scale, label: 'Disputes' },
            { id: 'risk', icon: AlertOctagon, label: 'Risk Radar' },
            { id: 'fraud', icon: ShieldAlert, label: 'Fraud' },
            { id: 'revenue', icon: DollarSign, label: 'Revenue' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`flex items-center gap-2.5 rounded-xl px-6 py-3 text-[9px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-black shadow-xl shadow-amber-500/20'
                  : 'text-slate-500 hover:text-slate-200'
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
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: 'System State',
                  value: platformHealth.systemLoad,
                  icon: HeartPulse,
                  color: platformHealth.systemLoad === 'optimal' ? 'text-green-500' : 'text-red-500'
                },
                {
                  label: 'Stuck Trades',
                  value: platformHealth.stuckTrades,
                  icon: Clock,
                  color: 'text-amber-500'
                },
                {
                  label: 'Open Reports',
                  value: platformHealth.openReports,
                  icon: Gavel,
                  color: 'text-blue-400'
                },
                {
                  label: 'Trade Volume',
                  value: formatMoney(
                    trades.reduce((sum, trade) => sum + safeNumber(trade.amount), 0)
                  ),
                  icon: TrendingUp,
                  color: 'text-green-500'
                }
              ].map(item => (
                <div
                  key={item.label}
                  className="space-y-4 rounded-[2.5rem] border border-white/5 bg-brand-card p-8"
                >
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {item.label}
                    </p>
                    <p className="mt-1 font-serif text-3xl uppercase text-white">
                      {item.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center justify-between gap-6 rounded-[2.5rem] border border-amber-500/20 bg-amber-500/10 p-8 md:flex-row">
              <div className="space-y-1">
                <h3 className="font-serif text-xl text-amber-500">
                  Tier Synchronization
                </h3>
                <p className="text-[10px] font-medium uppercase tracking-wider text-amber-500/60">
                  Audit users and refresh Elite, Trusted, and Driver performance badges.
                </p>
              </div>
              <button
                onClick={syncUserTiers}
                disabled={!!processing}
                className="rounded-xl bg-amber-500 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
              >
                {processing === 'sync_tiers' ? 'Auditing...' : 'Run Audit Cycle'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-10">
                <h3 className="flex items-center gap-3 font-serif text-2xl text-white">
                  <Truck className="h-5 w-5 text-amber-500" />
                  Top Performing Drivers
                </h3>
                <div className="space-y-4">
                  {users
                    .filter(u => u.roles?.includes('driver'))
                    .sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0))
                    .slice(0, 5)
                    .map((driver, index) => (
                      <div
                        key={driver.userId}
                        className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black text-slate-600">
                            0{index + 1}
                          </span>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider text-white">
                              {getDisplayName(driver)}
                            </p>
                            <p className="text-[9px] uppercase tracking-widest text-slate-500">
                              {driver.deliveriesCount || 0} Trips
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] font-black uppercase text-green-500">
                          {driver.reliabilityScore || 100}% Trust
                        </p>
                      </div>
                    ))}
                </div>
              </div>

              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-10">
                <h3 className="flex items-center gap-3 font-serif text-2xl text-white">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  Stuck Logistics Monitor
                </h3>
                <div className="space-y-4">
                  {trades
                    .filter(t => {
                      const lastActive = getMillis(t.lastActivityAt) || getMillis(t.createdAt);
                      return lastActive > 0 && Date.now() - lastActive > 86400000 && t.status !== 'completed';
                    })
                    .slice(0, 5)
                    .map(trade => (
                      <div
                        key={trade.id}
                        className="space-y-2 rounded-2xl border border-red-500/10 bg-red-500/5 p-5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase text-red-500">
                            Idle: 24H+
                          </span>
                          <span className="font-mono text-[9px] text-slate-600">
                            #{trade.id.slice(-6)}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-300">
                          Valuation: {formatMoney(safeNumber(trade.amount))}
                        </p>
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
                <div
                  key={u.userId}
                  className="flex flex-col items-center justify-between gap-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl md:flex-row"
                >
                  <div className="flex items-center gap-6">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] border border-white/5 bg-gradient-to-br from-amber-500/20 to-amber-500/5 font-serif text-2xl uppercase text-amber-500">
                      {getDisplayName(u).slice(0, 1)}
                    </div>
                    <div>
                      <h4 className="font-serif text-2xl text-white">
                        {getDisplayName(u)}
                      </h4>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {u.badges?.map(badge => (
                          <span
                            key={badge}
                            className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[8px] font-black uppercase text-amber-500"
                          >
                            {badge}
                          </span>
                        ))}
                        {u.sellerTier === 'elite' && (
                          <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-2.5 py-1 text-[8px] font-black uppercase tracking-tighter text-purple-400">
                            Elite Seller
                          </span>
                        )}
                        {u.subscription?.plan && (
                          <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-tighter text-green-400">
                            {u.subscription.plan} Plan
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">
                        {u.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex w-full gap-4 md:w-auto">
                    <button
                      onClick={() => handleFreezeUser(u.userId, 'Manual admin freeze from user table')}
                      disabled={!!processing}
                      className="flex-1 rounded-xl border border-red-500/20 bg-red-500/10 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-red-400 transition-all hover:bg-red-500 hover:text-black disabled:opacity-50 md:flex-none"
                    >
                      Freeze
                    </button>
                    <button
                      disabled
                      className="flex-1 rounded-xl bg-white/5 px-8 py-3 text-[10px] font-black uppercase tracking-widest text-white opacity-60 md:flex-none"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center pb-20 pt-10">
                <button
                  onClick={() => fetchData(true)}
                  disabled={loading}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-12 py-4 text-[10px] font-black uppercase tracking-[0.3em] text-white transition-all hover:bg-white/10 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load More Users'}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'moderators' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
            <div className="flex flex-col justify-between gap-6 rounded-[2.5rem] border border-amber-500/20 bg-amber-500/10 p-8 md:flex-row md:items-center">
              <div className="space-y-2">
                <h3 className="flex items-center gap-3 font-serif text-2xl text-white">
                  <BadgeCheck className="h-6 w-6 text-amber-500" />
                  Moderator Control
                </h3>
                <p className="max-w-3xl text-[10px] font-black uppercase leading-relaxed tracking-widest text-amber-500/70">
                  Approve trusted delivery moderators, suspend unsafe operators, and keep long-distance delivery coverage visible to buyers.
                </p>
              </div>
              <button
                onClick={seedDefaultModerator}
                disabled={processing === 'seed_default_moderator'}
                className="rounded-xl bg-amber-500 px-6 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl disabled:opacity-50"
              >
                {processing === 'seed_default_moderator'
                  ? 'Verifying...'
                  : 'Verify realmscity@gmail.com'}
              </button>
            </div>

            <div className="grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
              <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-serif text-2xl text-white">
                      Moderator Applications
                    </h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Admin approval is required before badges and requests unlock.
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                    {
                      moderatorApplications.filter(
                        application => application.status === 'pending_review'
                      ).length
                    } pending
                  </span>
                </div>

                <div className="space-y-4">
                  {moderatorApplications.length > 0 ? (
                    moderatorApplications.slice(0, 12).map(application => (
                      <div
                        key={application.id}
                        className="space-y-4 rounded-2xl border border-white/5 bg-black/30 p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-serif text-xl text-white">
                              {application.displayName || application.email || 'Moderator Applicant'}
                            </p>
                            <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
                              {application.cityOrRegion || 'Service region not listed'}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-[8px] font-black uppercase tracking-widest ${
                              application.status === 'approved'
                                ? 'bg-green-500/10 text-green-400'
                                : application.status === 'rejected'
                                  ? 'bg-red-500/10 text-red-400'
                                  : application.status === 'suspended'
                                    ? 'bg-slate-500/10 text-slate-400'
                                    : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {application.status || 'pending_review'}
                          </span>
                        </div>

                        <div className="grid gap-3 text-[10px] uppercase tracking-widest text-slate-500">
                          <p>
                            Phone:{' '}
                            <span className="text-slate-300">
                              {application.phoneNumber || 'Not provided'}
                            </span>
                          </p>
                          <p>
                            Routes:{' '}
                            <span className="text-slate-300">
                              {(application.routes || []).join(', ') || 'No routes listed'}
                            </span>
                          </p>
                          <p>
                            Capacity:{' '}
                            <span className="text-slate-300">
                              {application.transportCapacity || 'Not described'}
                            </span>
                          </p>
                        </div>

                        {application.status === 'pending_review' && (
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() =>
                                handleModeratorApplicationReview(application, 'approved')
                              }
                              disabled={processing === `moderator_application_${application.id}`}
                              className="flex-1 rounded-xl bg-green-500 py-3 text-[9px] font-black uppercase text-black disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                handleModeratorApplicationReview(application, 'rejected')
                              }
                              disabled={processing === `moderator_application_${application.id}`}
                              className="flex-1 rounded-xl bg-red-500/10 py-3 text-[9px] font-black uppercase text-red-400 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-8 text-center text-sm text-slate-500">
                      No moderator applications yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-serif text-2xl text-white">
                      Verified Moderators
                    </h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      These accounts appear in the public moderator directory.
                    </p>
                  </div>
                  <span className="rounded-full bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                    {users.filter(user => user.moderatorStatus === 'approved').length} active
                  </span>
                </div>

                <div className="grid gap-4">
                  {users.length > 0 ? (
                    users.map(moderator => {
                      const approved = moderator.moderatorStatus === 'approved';
                      const suspended = moderator.moderatorStatus === 'suspended';

                      return (
                        <div
                          key={moderator.userId}
                          className="rounded-2xl border border-white/5 bg-black/30 p-5"
                        >
                          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                            <div className="flex items-start gap-4">
                              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 font-serif text-xl uppercase text-amber-500">
                                {getDisplayName(moderator).slice(0, 1)}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-serif text-xl text-white">
                                    {getDisplayName(moderator)}
                                  </p>
                                  {approved && (
                                    <span className="flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
                                      <BadgeCheck className="h-3 w-3" />
                                      Verified Moderator
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
                                  {moderator.email || 'No email'} | {moderator.moderatorAvailability || 'offline'}
                                </p>
                                <p className="mt-3 max-w-2xl text-xs leading-relaxed text-slate-400">
                                  {moderator.moderatorTransportCapacity ||
                                    'Moderator service details have not been added yet.'}
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              {approved ? (
                                <button
                                  onClick={() => handleModeratorStatus(moderator, 'suspended')}
                                  disabled={processing === `moderator_${moderator.userId}`}
                                  className="rounded-xl bg-red-500/10 px-5 py-3 text-[9px] font-black uppercase tracking-widest text-red-400 disabled:opacity-50"
                                >
                                  Suspend
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleModeratorStatus(moderator, 'approved')}
                                  disabled={processing === `moderator_${moderator.userId}`}
                                  className="rounded-xl bg-green-500 px-5 py-3 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                                >
                                  {suspended ? 'Restore' : 'Approve'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="mt-5 grid gap-3 md:grid-cols-3">
                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                              <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                                Regions
                              </p>
                              <p className="mt-1 text-xs text-slate-300">
                                {(moderator.moderatorRegions || []).join(', ') ||
                                  moderator.moderatorCity ||
                                  moderator.location ||
                                  'Not listed'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                              <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                                Routes
                              </p>
                              <p className="mt-1 text-xs text-slate-300">
                                {(moderator.moderatorRoutes || []).join(', ') ||
                                  'No routes listed'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                              <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                                Performance
                              </p>
                              <p className="mt-1 text-xs text-slate-300">
                                {moderator.completedModeratorDeliveries || 0} deliveries |{' '}
                                {safeNumber(moderator.moderatorRating || moderator.averageRating).toFixed(1)} rating
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-8 text-center text-sm text-slate-500">
                      No verified moderators yet. Use the button above to verify the default account after it signs in.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        )}

        {activeTab === 'disputes' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            {trades.filter(t => t.isDisputed).length === 0 ? (
              <div className="rounded-[3rem] border border-white/5 bg-brand-card p-20 text-center shadow-2xl">
                <ShieldCheck className="mx-auto h-12 w-12 text-slate-800" />
                <h3 className="mt-8 font-serif text-3xl italic text-white">
                  Clear Justice Docket
                </h3>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  No active disputes requiring intervention.
                </p>
              </div>
            ) : (
              <div className="grid gap-6">
                {trades
                  .filter(t => t.isDisputed)
                  .map(trade => (
                    <div
                      key={trade.id}
                      className="space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10 shadow-2xl"
                    >
                      <div className="flex flex-col items-start justify-between gap-6 border-b border-white/5 pb-8 md:flex-row">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <Scale className="h-5 w-5 text-amber-500" />
                            <h3 className="font-serif text-3xl text-white">
                              Pending Arbitration
                            </h3>
                          </div>
                          <p className="text-xs text-slate-500">
                            Trade reference:{' '}
                            <span className="font-mono tracking-widest text-amber-500">
                              #{trade.id.toUpperCase()}
                            </span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            Impact Value
                          </p>
                          <p className="font-serif text-3xl text-white">
                            {formatMoney(safeNumber(trade.amount))}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 md:flex-row">
                        <button
                          onClick={() => handleDisputeResolution(trade.id, 'seller')}
                          disabled={processing === trade.id}
                          className="flex-1 rounded-xl bg-white p-5 text-[10px] font-black uppercase tracking-widest text-black shadow-xl transition-all hover:bg-amber-500 disabled:opacity-50"
                        >
                          Rule for Seller
                        </button>
                        <button
                          onClick={() => handleDisputeResolution(trade.id, 'buyer')}
                          disabled={processing === trade.id}
                          className="flex-1 rounded-xl border border-white/10 bg-white/5 p-5 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:border-red-500/20 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Rule for Buyer
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'revenue' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: 'Total Revenue',
                  value: formatMoney(revenueSummary.totalPlatformRevenue),
                  icon: WalletCards,
                  color: 'text-amber-500'
                },
                {
                  label: 'This Month',
                  value: formatMoney(revenueSummary.currentMonthRevenue),
                  icon: BarChart3,
                  color: 'text-green-400'
                },
                {
                  label: 'MRR',
                  value: formatMoney(revenueSummary.monthlyRecurringRevenue),
                  icon: CreditCard,
                  color: 'text-blue-400'
                },
                {
                  label: 'Pending Escrow',
                  value: formatMoney(revenueSummary.pendingEscrowBalance),
                  icon: ShieldCheck,
                  color: 'text-purple-400'
                }
              ].map(metric => (
                <div
                  key={metric.label}
                  className="rounded-[2.2rem] border border-white/5 bg-brand-card p-7 shadow-xl"
                >
                  <metric.icon className={`h-6 w-6 ${metric.color}`} />
                  <p className="mt-5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {metric.label}
                  </p>
                  <p className="mt-2 font-serif text-3xl text-white">
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-8 rounded-[3rem] border border-white/5 bg-brand-card p-10 shadow-2xl">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h3 className="font-serif text-3xl text-white">
                      Revenue Ledger
                    </h3>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Platform fees, commissions, boosts, verification, and withdrawals
                    </p>
                  </div>
                  <p className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-amber-500">
                    {revenueRecords.length} ledger records
                  </p>
                </div>

                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueSummary.categories}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                      <XAxis
                        dataKey="name"
                        stroke="#64748b"
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="#64748b"
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value: any) => formatMoney(safeNumber(value))}
                        contentStyle={{
                          background: '#09090b',
                          border: '1px solid rgba(255,255,255,.1)',
                          borderRadius: '14px',
                          color: 'white'
                        }}
                      />
                      <Bar dataKey="value" fill="#f59e0b" radius={[12, 12, 0, 0]} barSize={42} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-[3rem] border border-white/5 bg-brand-card p-10 shadow-2xl">
                <h3 className="font-serif text-2xl text-white">Revenue Mix</h3>
                <div className="mt-6 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueSummary.categories}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={58}
                        outerRadius={92}
                        paddingAngle={4}
                      >
                        {revenueSummary.categories.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => formatMoney(safeNumber(value))}
                        contentStyle={{
                          background: '#09090b',
                          border: '1px solid rgba(255,255,255,.1)',
                          borderRadius: '14px',
                          color: 'white'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-3">
                  {revenueSummary.categories.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                          {item.name}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-white">{formatMoney(item.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {[
                { label: 'Trade Fees', value: revenueSummary.tradeFees, icon: ShoppingBag },
                { label: 'Delivery Commission', value: revenueSummary.deliveryCommissions, icon: Truck },
                { label: 'Subscriptions', value: revenueSummary.subscriptionRevenue, icon: CreditCard },
                { label: 'Listing Boosts', value: revenueSummary.boostRevenue, icon: TrendingUp },
                { label: 'Verification', value: revenueSummary.verificationRevenue, icon: BadgeCheck },
                { label: 'Withdrawal Fees', value: revenueSummary.withdrawalFees, icon: Banknote }
              ].map(item => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-[2rem] border border-white/5 bg-brand-card p-6"
                >
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {item.label}
                    </p>
                    <p className="mt-2 font-serif text-2xl text-white">
                      {formatMoney(item.value)}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/40 text-amber-500">
                    <item.icon className="h-5 w-5" />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8">
                <h3 className="font-serif text-2xl text-white">Top Sellers by Volume</h3>
                <div className="space-y-3">
                  {revenueSummary.topSellers.length > 0 ? (
                    revenueSummary.topSellers.map((seller, index) => (
                      <div
                        key={seller.sellerId}
                        className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/30 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black text-slate-600">
                            0{index + 1}
                          </span>
                          <div>
                            <p className="text-sm font-bold text-white">{seller.name}</p>
                            <p className="text-[9px] uppercase tracking-widest text-slate-500">
                              {seller.trades} completed trades
                            </p>
                          </div>
                        </div>
                        <p className="font-serif text-lg text-white">
                          {formatMoney(seller.volume)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-6 text-center text-sm text-slate-500">
                      No completed seller volume yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-serif text-2xl text-white">Payout Queue</h3>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                    {pendingPayouts.length} pending
                  </span>
                </div>
                <div className="space-y-3">
                  {pendingPayouts.slice(0, 5).map(payout => (
                    <div
                      key={payout.id}
                      className="space-y-4 rounded-2xl border border-white/5 bg-black/30 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">
                            {formatMoney(safeNumber(payout.netAmount ?? payout.amount))}
                          </p>
                          <p className="text-[9px] uppercase tracking-widest text-slate-500">
                            {payout.role || payout.type || 'wallet'} payout
                          </p>
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-500">
                          {payout.status || 'pending'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePayoutStatus(payout, 'processing')}
                          disabled={processing === `payout_${payout.id}`}
                          className="flex-1 rounded-xl bg-white/5 py-2 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50"
                        >
                          Processing
                        </button>
                        <button
                          onClick={() => handlePayoutStatus(payout, 'paid')}
                          disabled={processing === `payout_${payout.id}`}
                          className="flex-1 rounded-xl bg-green-500 py-2 text-[9px] font-black uppercase text-black disabled:opacity-50"
                        >
                          Paid
                        </button>
                        <button
                          onClick={() => handlePayoutStatus(payout, 'rejected')}
                          disabled={processing === `payout_${payout.id}`}
                          className="flex-1 rounded-xl bg-red-500/10 py-2 text-[9px] font-black uppercase text-red-400 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingPayouts.length === 0 && (
                    <div className="rounded-2xl border border-white/5 bg-black/30 p-6 text-center text-sm text-slate-500">
                      No payout requests are waiting.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-serif text-2xl text-white">Verification Review</h3>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Verified sellers receive more buyer trust.
                  </p>
                </div>
                <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-amber-500">
                  {pendingVerifications.length} pending
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {pendingVerifications.slice(0, 6).map(request => (
                  <div
                    key={request.id}
                    className="space-y-4 rounded-2xl border border-white/5 bg-black/30 p-5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold uppercase tracking-wider text-white">
                          {request.type || 'User'} Verification
                        </p>
                        <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">
                          User: {request.userId?.slice(-8) || 'unknown'}
                        </p>
                      </div>
                      <p className="text-sm font-black text-amber-500">
                        {formatMoney(safeNumber(request.amountPaid))}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleVerificationReview(request, 'approved')}
                        disabled={processing === `verification_${request.id}`}
                        className="flex-1 rounded-xl bg-green-500 py-3 text-[9px] font-black uppercase text-black disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleVerificationReview(request, 'rejected')}
                        disabled={processing === `verification_${request.id}`}
                        className="flex-1 rounded-xl bg-red-500/10 py-3 text-[9px] font-black uppercase text-red-400 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {pendingVerifications.length === 0 && (
                <div className="rounded-2xl border border-white/5 bg-black/30 p-6 text-center text-sm text-slate-500">
                  No verification requests are waiting.
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'risk' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <h3 className="px-2 font-serif text-2xl text-white">
                  High Risk User Nodes
                </h3>
                {users
                  .filter(u => u.riskLevel === 'high' || u.riskLevel === 'medium')
                  .map(u => (
                    <div
                      key={u.userId}
                      className="flex items-center justify-between rounded-[2rem] border border-red-500/10 bg-brand-card p-8"
                    >
                      <div className="flex items-center gap-5">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                          <AlertOctagon className="h-6 w-6" />
                        </div>
                        <div>
                          <h4 className="font-serif text-xl text-white">{getDisplayName(u)}</h4>
                          <p className="text-[9px] font-black uppercase tracking-widest text-red-500/80">
                            Risk Level: {u.riskLevel}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleFreezeUser(u.userId, 'Flagged by risk engine')}
                        disabled={!!processing}
                        className="rounded-xl bg-red-500 px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black transition-transform active:scale-95 disabled:opacity-50"
                      >
                        Freeze
                      </button>
                    </div>
                  ))}
              </div>

              <div className="space-y-8 rounded-[2.5rem] border border-white/5 bg-brand-card p-10">
                <h3 className="font-serif text-xl italic text-white">Safety KPI</h3>
                {[
                  { label: 'Trust Index', value: 88, color: 'bg-amber-500' },
                  { label: 'Fraud Prevention', value: 99.4, color: 'bg-green-500' }
                ].map(item => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                      <span className="text-slate-500">{item.label}</span>
                      <span className="text-white">{item.value}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                      <div className={`h-full ${item.color}`} style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'fraud' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-10">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <h3 className="px-2 font-serif text-2xl text-white">
                  Fraud Signal Monitor
                </h3>
                {trades
                  .filter(t => safeNumber(t.amount) > 500000 || t.isDisputed)
                  .map(trade => (
                    <div
                      key={trade.id}
                      className="space-y-4 rounded-[2rem] border border-red-500/10 bg-brand-card p-8 shadow-xl"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className="rounded-xl bg-red-500/10 p-3 text-red-500">
                            <FileSearch className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-white">
                              Large Transaction: {formatMoney(safeNumber(trade.amount))}
                            </p>
                            <p className="text-[9px] uppercase tracking-widest text-slate-500">
                              Trade: #{trade.id.slice(-8)}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full bg-red-500 px-3 py-1 text-[8px] font-black uppercase text-black">
                          Suspicious
                        </span>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => handleDisputeResolution(trade.id, 'buyer')}
                          className="flex-1 rounded-xl border border-red-500/20 bg-red-500/10 py-3 text-[10px] font-black uppercase text-red-500"
                        >
                          Hold Transaction
                        </button>
                        <button className="flex-1 rounded-xl border border-white/5 bg-white/5 py-3 text-[10px] font-black uppercase text-slate-400">
                          Verify ID
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="space-y-6">
                <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-10">
                  <h4 className="font-serif text-lg text-white">Threat Indicators</h4>
                  <div className="space-y-4">
                    {[
                      { label: 'Sybil Attack Patterns', count: 0 },
                      { label: 'Card Testing Signals', count: 1 },
                      { label: 'Location Mismatches', count: 3 }
                    ].map(item => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 p-4"
                      >
                        <p className="text-[10px] font-bold text-slate-400">{item.label}</p>
                        <span className="rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-500">
                          {item.count}
                        </span>
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
