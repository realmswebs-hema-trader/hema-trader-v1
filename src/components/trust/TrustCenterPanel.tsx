import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Crown,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Star,
  Timer,
  Truck,
  Users,
  Zap
} from 'lucide-react';
import { motion } from 'motion/react';

import {
  calculateTrustScore,
  getTrustBadges,
  getTrustLevel,
  subscribeToUserTrust,
  type TrustLevel
} from '../../services/trustScoreService';

interface TrustCenterPanelProps {
  userId: string;
  profile: any;
  isOwnProfile?: boolean;
}

const levelStyles: Record<TrustLevel, { ring: string; text: string; glow: string }> = {
  'HIGH RISK': {
    ring: '#ef4444',
    text: 'text-red-500',
    glow: 'shadow-red-500/20'
  },
  'LOW TRUST': {
    ring: '#f97316',
    text: 'text-orange-500',
    glow: 'shadow-orange-500/20'
  },
  STANDARD: {
    ring: '#f59e0b',
    text: 'text-amber-500',
    glow: 'shadow-amber-500/20'
  },
  TRUSTED: {
    ring: '#22c55e',
    text: 'text-green-500',
    glow: 'shadow-green-500/20'
  },
  ELITE: {
    ring: '#facc15',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-500/25'
  },
  'VERIFIED ELITE': {
    ring: '#fbbf24',
    text: 'text-amber-300',
    glow: 'shadow-amber-400/30'
  }
};

const badgeIcon = (badge: string) => {
  if (badge.includes('Driver')) return Truck;
  if (badge.includes('Elite') || badge.includes('Founder')) return Crown;
  if (badge.includes('Rated')) return Star;
  if (badge.includes('Active') || badge.includes('Fast')) return Zap;
  if (badge.includes('Phone')) return ShieldCheck;
  return BadgeCheck;
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function TrustCenterPanel({
  userId,
  profile,
  isOwnProfile = false
}: TrustCenterPanelProps) {
  const [liveTrust, setLiveTrust] = useState<any>(null);

  useEffect(() => {
    if (!userId) return undefined;

    return subscribeToUserTrust(userId, trust => {
      setLiveTrust(trust);
    });
  }, [userId]);

  const mergedProfile = liveTrust?.profile
    ? { ...profile, ...liveTrust.profile }
    : profile;

  const trustScore = safeNumber(
    liveTrust?.trustScore ?? mergedProfile?.trustScore,
    calculateTrustScore(mergedProfile)
  );

  const trustLevel =
    liveTrust?.trustLevel || mergedProfile?.trustLevel || getTrustLevel(trustScore);

  const badges = useMemo(
    () => liveTrust?.trustBadges || mergedProfile?.trustBadges || getTrustBadges({ ...mergedProfile, trustScore }),
    [liveTrust, mergedProfile, trustScore]
  );

  const style = levelStyles[trustLevel as TrustLevel] || levelStyles.STANDARD;
  const circumference = 2 * Math.PI * 48;
  const strokeDashoffset = circumference - (trustScore / 100) * circumference;

  const metrics = [
    {
      label: 'Escrow Success',
      value: `${safeNumber(mergedProfile?.escrowSuccessRate, safeNumber(mergedProfile?.successfulTrades) ? 90 : 0)}%`,
      icon: Shield
    },
    {
      label: 'Successful Trades',
      value: safeNumber(
        mergedProfile?.successfulTrades ??
          mergedProfile?.completedTrades ??
          mergedProfile?.totalTrades
      ),
      icon: ShieldCheck
    },
    {
      label: 'Delivery Completion',
      value: `${safeNumber(
        mergedProfile?.deliveryCompletionRate ??
          mergedProfile?.deliverySuccessRate,
        safeNumber(mergedProfile?.completedDeliveries) ? 90 : 0
      )}%`,
      icon: Truck
    },
    {
      label: 'Response Rate',
      value: `${safeNumber(mergedProfile?.responseRate, 0)}%`,
      icon: Timer
    },
    {
      label: 'Community Rating',
      value: safeNumber(
        mergedProfile?.averageRating || mergedProfile?.avgDriverRating,
        0
      ).toFixed(1),
      icon: Star
    },
    {
      label: 'Followers',
      value: safeNumber(mergedProfile?.followersCount, 0),
      icon: Users
    }
  ];

  return (
    <section className={`overflow-hidden rounded-[2.5rem] border border-white/5 bg-brand-card shadow-2xl ${style.glow}`}>
      <div className="grid grid-cols-1 gap-8 p-6 sm:p-8 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-black/30 p-8 text-center">
          <div className="relative h-36 w-36">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r="48"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="10"
                fill="none"
              />
              <motion.circle
                cx="60"
                cy="60"
                r="48"
                stroke={style.ring}
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 1.1, ease: 'easeOut' }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="font-serif text-4xl text-white">{trustScore}%</p>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                Trust Score
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className={`text-[10px] font-black uppercase tracking-[0.25em] ${style.text}`}>
              {trustLevel}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Trust grows through completed trades, verified identity, delivery success,
              reviews, activity, and community credibility.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-amber-500" />
                <h3 className="font-serif text-2xl text-white">Trust Center</h3>
              </div>
              <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">
                Reputation, safety, escrow confidence, and marketplace visibility
              </p>
            </div>

            {isOwnProfile && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-right">
                <p className="text-[8px] font-black uppercase tracking-widest text-amber-500">
                  Visibility Boost
                </p>
                <p className="font-serif text-xl text-white">
                  x{safeNumber(liveTrust?.visibilityMultiplier ?? mergedProfile?.trustVisibilityMultiplier, 1).toFixed(2)}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {metrics.map(item => (
              <div key={item.label} className="rounded-2xl border border-white/5 bg-black/30 p-4">
                <item.icon className="mb-3 h-5 w-5 text-amber-500" />
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  {item.label}
                </p>
                <p className="mt-1 truncate font-serif text-lg text-white">
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                Public Trust Badges
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {badges.length > 0 ? (
                badges.map((badge: string) => {
                  const Icon = badgeIcon(badge);

                  return (
                    <span
                      key={badge}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-amber-400"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {badge}
                    </span>
                  );
                })
              ) : (
                <span className="text-sm text-slate-500">
                  Trust badges will appear as this trader completes more activity.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
