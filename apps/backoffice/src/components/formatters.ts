const zeroDecimalCurrencies = new Set(["IDR", "JPY", "KRW"]);

export function formatMinorCurrency(
  amount: bigint | number | string,
  currency: string,
) {
  const numericAmount = typeof amount === "bigint" ? Number(amount) : Number(amount);
  const exponent = zeroDecimalCurrencies.has(currency.toUpperCase()) ? 0 : 2;

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: exponent,
  }).format(numericAmount / 10 ** exponent);
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function minorToInputValue(amount: bigint, currency: string) {
  const exponent = zeroDecimalCurrencies.has(currency.toUpperCase()) ? 0 : 2;
  return (Number(amount) / 10 ** exponent).toFixed(exponent);
}

export function basisPointsToPercent(rate: number) {
  return (rate / 100).toString();
}
