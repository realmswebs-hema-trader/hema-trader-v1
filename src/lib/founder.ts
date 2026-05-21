export const FOUNDER_EMAIL = 'realmswebs@gmail.com';
export const FOUNDER_NAME = 'Hema Trader';
export const FOUNDER_USERNAME = 'hema.trader';

export const FOUNDER_ROLES = ['buyer', 'seller', 'driver', 'admin'];

export const FOUNDER_BADGES = [
  'Founder',
  'Hema Trader Founder',
  'Email Verified',
  'Phone Verified',
  'Verified Identity',
  'Verified Driver',
  'Trusted',
  'Elite Trader',
  'Elite Driver',
  'Fast Responder',
  'Top Rated',
  'Active Trader',
  'Elite Verified'
];

export const normalizeNameKey = (value = '') =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

export const RESERVED_NAME_KEYS = [
  'hema trader',
  'hematrader',
  'hema-trader',
  'hema.trader'
];

export const isFounderEmail = (email?: string | null) =>
  email?.trim().toLowerCase() === FOUNDER_EMAIL;

export const isReservedPlatformName = (
  name?: string,
  email?: string | null
) => {
  if (!name || isFounderEmail(email)) return false;
  return RESERVED_NAME_KEYS.includes(normalizeNameKey(name));
};

export const isFounderIdentity = (profile?: any, user?: any) =>
  Boolean(
    profile?.isFounder ||
      profile?.founderVerified ||
      isFounderEmail(profile?.email) ||
      isFounderEmail(user?.email)
  );

export const getFounderUserFields = () => ({
  displayName: FOUNDER_NAME,
  name: FOUNDER_NAME,
  username: FOUNDER_USERNAME,
  displayNameKey: normalizeNameKey(FOUNDER_NAME),
  usernameKey: normalizeNameKey(FOUNDER_USERNAME),
  email: FOUNDER_EMAIL,

  isFounder: true,
  founderVerified: true,
  isAdmin: true,
  roles: FOUNDER_ROLES,

  verificationStatus: 'verified',
  emailVerified: true,
  phoneVerified: true,
  identityVerified: true,
  driverVerified: true,
  eliteVerified: true,

  trustScore: 100,
  trustLevel: 'VERIFIED ELITE',
  trustBadges: FOUNDER_BADGES,
  verificationScore: 100,

  accountRiskStatus: 'clear',
  fraudProtectionStatus: 'protected',
  instantTransactionsEnabled: true,
  premiumVisibility: true,
  marketplaceVisibility: 2,
  trustVisibilityMultiplier: 2,
  searchRankBoost: 2
});
