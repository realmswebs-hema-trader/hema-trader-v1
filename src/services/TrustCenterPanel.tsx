import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Crown,
  Flame,
  MessageCircle,
  Shield,
  ShieldCheck,
  Star,
  Truck,
  Users,
  Zap
} from 'lucide-react';

import {
  TrustLevel,
  getTrustBadges,
  getTrustLevel,
  subscribeToUserTrust
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
    glow: 'shadow-[0_0_35px_rgba(239,68,68,0.2)]'
  },
  'LOW TRUST': {
    ring: '#f97316',
    text: 'text-orange-500',
    glow: 'shadow-[0_0_35px_rgba(249,115,22,0.18)]'
  },
  STANDARD: {
    ring: '#f59e0b',
    text: 'text-amber-500',
    glow: 'shadow-[0_0_35px_rgba(245,158,11,0.16)]'
  },
  TRUSTED: {
    ring: '#22c55e',
    text: 'text-green-500',
    glow: 'shadow-[0_0_35px_rgba(34,197,94,0.18)]'
  },
  ELITE: {
    ring: '#fbbf24',
    text: 'text-yellow-400',
    glow: 'shadow-[0_0_45px_rgba(251,191,36,0.24)]'
  },
  'VERIFIED ELITE': {
    ring: '#facc15',
    text: 'text-yellow-300',
    glow: 'shadow-[0_0_55px_rgba(250,204,21,0.28)]'
  }
};

const badgeIcon = (badge: string) => {
  if (badge.includes('Elite')) return Crown;
  if (badge.includes('Driver')) return Truck;
  if (badge.includes('Responder')) return Flame;
  if (badge.includes('Rated')) return Star;
  if (badge.includes('Active')) return Zap;
  if (badge.includes('Verified')) return BadgeCheck;
  return ShieldCheck;
};

export default function TrustCenterPanel({
  userId,
  profile,
  isOwnProfile = false
}: TrustCenterPanelProps) {
  const [trustProfile, setTrustProfile] = useState(profile);

  useEffect(() => {
    if (!userId) return;

    return subscribeToUserTrust(userId, trust => {
      setTrustProfile({
        ...profile,
        ...trust.profile,
        trustScore: trust.trustScore,
        trustLevel: trust.trustLevel,
        trustBadges: trust.trustBadges
      });
    });
  }, [userId, profile]);

  const trustScore = Number(trustProfile?.trustScore || 50);
  const trustLevel = trustProfile?.trustLevel || getTrustLevel(trustScore);
  const style = levelStyles[trustLevel as TrustLevel] || levelStyles.STANDARD;
  const badges = trustProfile?.trustBadges || getTrustBadges(trustProfile);

  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (trustScore / 100) * circumference;

  const metrics = [
    {
      label: 'Escrow Success',
      value: `${trustProfile?.escrowSuccessRate || 0}%`,
      icon: ShieldCheck
    },
    {
      label: 'Successful Trades',
      value: trustProfile?.successfulTrades || trustProfile?.completedTrades || trustProfile?.totalTrades || 0,
      icon: CheckCircle2
    },
    {
      label: 'Delivery Completion',
      value: `${trustProfile?.deliveryCompletionRate || trustProfile?.deliverySuccessRate || 0}%`,
      icon: Truck
    },
    {
      label: 'Response Rate',
      value: `${trustProfile?.responseRate || 0}%`,
      icon: MessageCircle
    },
    {
      label: 'Community Rating',
      value: Number(trustProfile?.averageRating || trustProfile?.avgDriverRating || 0).toFixed(1),
      icon: Star
    },
    {
      label: 'Followers',
      value: trustProfile?.followersCount || 0,
      icon: Users
    }
  ];

  return (
    <section className={`rounded-[2rem] border border-white/5 bg-brand-card p-5 shadow-2xl ${style.glow}`}>
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-black/30 p-6 text-center">
          <div className="relative h-36 w-36">
            <svg className="h-36 w-36 -rotate-90">
              <circle
                cx="72"
                cy="72"
                r={radius}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="10"
                fill="transparent"
              />
              <circle
                cx="72"
                cy="72"
                r={radius}
                stroke={style.ring}
                strokeWidth="10"
                fill="transparent"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={progress}
                className="transition-all duration-1000"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="font-serif text-4xl text-white">{trustScore}%</p>
              <p className={`text-[8px] font-black uppercase tracking-widest ${style.text}`}>
                Trust Score
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
            {trustScore <= 40 ? (
              <AlertTriangle className={`h-4 w-4 ${style.text}`} />
            ) : (
              <Shield className={`h-4 w-4 ${style.text}`} />
            )}
            <span className={`text-[9px] font-black uppercase tracking-widest ${style.text}`}>
              {trustLevel}
            </span>
          </div>

          <p className="mt-4 text-[10px] uppercase leading-relaxed tracking-widest text-slate-500">
            {trustScore >= 81
              ? 'Premium visibility active'
              : trustScore >= 61
                ? 'Trusted marketplace profile'
                : trustScore >= 41
                  ? 'Standard trading access'
                  : 'Restrictions may apply'}
          </p>
        </div>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-500">
                Hema Trust Center
              </p>
              <h3 className="mt-1 font-serif text-3xl text-white">
                Trust is marketplace currency
              </h3>
            </div>

            {isOwnProfile && (
              <div className="rounded-xl border border-white/5 bg-black/30 px-4 py-3 text-right">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Visibility Multiplier
                </p>
                <p className="font-serif text-xl text-amber-500">
                  x{Number(trustProfile?.trustVisibilityMultiplier || 1).toFixed(2)}
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
                <p className="mt-1 font-serif text-xl text-white">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {badges.length > 0 ? (
              badges.map((badge: string) => {
                const Icon = badgeIcon(badge);

                return (
                  <span
                    key={badge}
                    className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-amber-500"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {badge}
                  </span>
                );
              })
            ) : (
              <span className="rounded-full border border-white/5 bg-white/5 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-slate-500">
                Build trust through verified trades
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Fraud Protection Status
            </p>
            <p className="mt-2 font-serif text-sm leading-relaxed text-slate-300">
              {trustProfile?.accountRiskStatus === 'clear' || !trustProfile?.accountRiskStatus
                ? 'No active fraud restrictions. Escrow confidence is available for this profile.'
                : 'This profile is under automated trust review. Some marketplace privileges may be limited.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
