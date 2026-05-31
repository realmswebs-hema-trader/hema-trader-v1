export type BoostType = 'oneDay' | 'threeDays' | 'sevenDays' | 'homepage';

export interface ListingBoost {
  isBoosted?: boolean;
  boostType?: BoostType | null;
  startedAt?: any;
  expiresAt?: any;
  amountPaid?: number;
}

export interface BoostableListing {
  isBoosted?: boolean;
  boost?: ListingBoost | null;
  createdAt?: any;
}

const boostPriority: Record<BoostType, number> = {
  homepage: 4,
  sevenDays: 3,
  threeDays: 2,
  oneDay: 1
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

export const isListingBoostActive = (listing: BoostableListing) => {
  const boost = listing.boost;

  if (boost?.isBoosted) {
    const expiresAt = getMillis(boost.expiresAt);
    return !expiresAt || expiresAt > Date.now();
  }

  return Boolean(listing.isBoosted);
};

export const getListingBoostPriority = (listing: BoostableListing) => {
  if (!isListingBoostActive(listing)) return 0;

  const boostType = listing.boost?.boostType;
  return boostType ? boostPriority[boostType] || 1 : 1;
};

export const getListingBoostLabel = (listing: BoostableListing) => {
  if (!isListingBoostActive(listing)) return '';

  switch (listing.boost?.boostType) {
    case 'homepage':
      return 'Homepage Boost';
    case 'sevenDays':
      return '7 Day Boost';
    case 'threeDays':
      return '3 Day Boost';
    case 'oneDay':
      return '1 Day Boost';
    default:
      return 'Boosted';
  }
};
