export const countryCurrencyMap: Record<string, { code: string; symbol: string; locale: string }> = {
  cameroon: { code: 'XAF', symbol: 'FCFA', locale: 'fr-CM' },
  nigeria: { code: 'NGN', symbol: '₦', locale: 'en-NG' },
  ghana: { code: 'GHS', symbol: '₵', locale: 'en-GH' },
  kenya: { code: 'KES', symbol: 'KSh', locale: 'en-KE' },
  uganda: { code: 'UGX', symbol: 'USh', locale: 'en-UG' },
  tanzania: { code: 'TZS', symbol: 'TSh', locale: 'sw-TZ' },
  rwanda: { code: 'RWF', symbol: 'RF', locale: 'rw-RW' },
  south_africa: { code: 'ZAR', symbol: 'R', locale: 'en-ZA' },
  united_states: { code: 'USD', symbol: '$', locale: 'en-US' }
};

export const getCurrencyForCountry = (country?: string) => {
  const key = (country || 'cameroon').toLowerCase().replace(/\s+/g, '_');
  return countryCurrencyMap[key] || countryCurrencyMap.cameroon;
};

export const formatMoney = (
  amount: number,
  currencyCode = 'XAF',
  locale = 'fr-CM'
) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: currencyCode === 'XAF' ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${currencyCode} ${(amount || 0).toLocaleString()}`;
  }
};
