import { BadgeCheck } from 'lucide-react';

interface ModeratorBadgeProps {
  profile?: {
    roles?: string[];
    isModerator?: boolean;
    moderatorVerified?: boolean;
    moderatorStatus?: string;
  } | null;
  compact?: boolean;
}

export const isVerifiedModeratorProfile = (profile?: ModeratorBadgeProps['profile']) =>
  Boolean(
    profile &&
      profile.isModerator === true &&
      profile.moderatorVerified === true &&
      profile.moderatorStatus === 'approved' &&
      profile.roles?.includes('moderator')
  );

export default function ModeratorBadge({
  profile,
  compact = false
}: ModeratorBadgeProps) {
  if (!isVerifiedModeratorProfile(profile)) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-green-400">
      <BadgeCheck className="h-3 w-3" />
      {compact ? 'Moderator' : 'Verified Moderator'}
    </span>
  );
}
