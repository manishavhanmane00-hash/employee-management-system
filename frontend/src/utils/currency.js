const currencyOptions = (currency, decimals) => {
  if (!['INR', 'USD'].includes(currency)) return null;
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const formatINR = (value, options = {}) => {
  const { decimals = 0, compact = false, currency = 'INR' } = options;
  const num = Number(value) || 0;
  if (!['INR', 'USD'].includes(currency)) {
    const formatted = Math.abs(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `Unverified currency: ${formatted}`;
  }
  if (compact) {
    const absolute = Math.abs(num);
    const scale = absolute >= 1000000000 ? 1000000000
      : absolute >= 1000000 ? 1000000
        : absolute >= 1000 ? 1000 : 1;
    const suffix = scale === 1000000000 ? 'B' : scale === 1000000 ? 'M' : scale === 1000 ? 'K' : '';
    if (scale > 1) {
      return `${currencyOptions(currency, 1).format(num / scale)}${suffix}`;
    }
  }
  return currencyOptions(currency, decimals).format(num);
};

export const monthlyINR = (annualAmount, options = {}) =>
  formatINR(Math.round(annualAmount / 12), options);

export const CURRENCY_SYMBOL = '₹';
export const CURRENCY_CODE = 'INR';
export const CURRENCY_LOCALE = 'en-IN';

export const formatINRCompact = (value, currency = 'INR') =>
  formatINR(value, { compact: true, currency });
