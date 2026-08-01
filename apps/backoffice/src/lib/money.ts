const QUANTITY_SCALE = 6;
const QUANTITY_FACTOR = 10n ** BigInt(QUANTITY_SCALE);
const TAX_BASIS_POINTS = 10_000n;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CURRENCY_FRACTION_DIGITS: Readonly<Record<string, number>> = {
  IDR: 0,
  USD: 2,
  SGD: 2,
  EUR: 2,
};

export type MinorUnitsInput = bigint | string;

export type LineAmountInput = {
  quantity: string;
  unitPriceMinor: MinorUnitsInput;
  discountMinor?: MinorUnitsInput;
  taxRateBps?: number;
};

export type LineAmounts = {
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  taxRateBps: number;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

export type InvoiceTotals = {
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

function assertPostgresBigint(value: bigint, field: string) {
  if (value < -POSTGRES_BIGINT_MAX || value > POSTGRES_BIGINT_MAX) {
    throw new RangeError(`${field} exceeds the PostgreSQL bigint range`);
  }
  return value;
}

export function parseMinorUnits(
  value: MinorUnitsInput,
  field = 'Amount'
): bigint {
  if (typeof value === 'bigint') {
    return assertPostgresBigint(value, field);
  }

  if (!/^-?(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${field} must be an integer minor-unit value`);
  }

  return assertPostgresBigint(BigInt(value), field);
}

export function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('Currency must be a three-letter ISO code');
  }
  return currency;
}

export function normalizeQuantity(value: string) {
  const quantity = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(quantity)) {
    throw new TypeError(
      'Quantity must be a positive decimal with at most 6 fractional digits'
    );
  }

  const [whole, fraction = ''] = quantity.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  const normalized = normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
  if (normalized === '0') {
    throw new RangeError('Quantity must be greater than zero');
  }
  return normalized;
}

function quantityToScaledInteger(quantity: string) {
  const normalized = normalizeQuantity(quantity);
  const [whole, fraction = ''] = normalized.split('.');
  return {
    normalized,
    scaled:
      BigInt(whole) * QUANTITY_FACTOR +
      BigInt(fraction.padEnd(QUANTITY_SCALE, '0')),
  };
}

function roundHalfUp(numerator: bigint, denominator: bigint) {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError('Money rounding expects non-negative values');
  }
  return (numerator + denominator / 2n) / denominator;
}

export function calculateLineAmounts(input: LineAmountInput): LineAmounts {
  const { normalized: quantity, scaled } = quantityToScaledInteger(input.quantity);
  const unitPriceMinor = parseMinorUnits(input.unitPriceMinor, 'Unit price');
  const discountMinor = parseMinorUnits(input.discountMinor ?? 0n, 'Discount');
  const taxRateBps = input.taxRateBps ?? 0;

  if (unitPriceMinor < 0n || discountMinor < 0n) {
    throw new RangeError('Unit price and discount cannot be negative');
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 100_000) {
    throw new RangeError('Tax rate must be an integer between 0 and 100000 bps');
  }

  const subtotalMinor = assertPostgresBigint(
    roundHalfUp(scaled * unitPriceMinor, QUANTITY_FACTOR),
    'Line subtotal'
  );
  if (discountMinor > subtotalMinor) {
    throw new RangeError('Discount cannot exceed the line subtotal');
  }

  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = assertPostgresBigint(
    roundHalfUp(taxableMinor * BigInt(taxRateBps), TAX_BASIS_POINTS),
    'Line tax'
  );
  const totalMinor = assertPostgresBigint(taxableMinor + taxMinor, 'Line total');

  return {
    quantity,
    unitPriceMinor,
    discountMinor,
    taxRateBps,
    subtotalMinor,
    taxMinor,
    totalMinor,
  };
}

export function calculateInvoiceTotals(
  lines: ReadonlyArray<
    Pick<LineAmounts, 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'>
  >
): InvoiceTotals {
  const totals = lines.reduce<InvoiceTotals>(
    (result, line) => ({
      subtotalMinor: result.subtotalMinor + line.subtotalMinor,
      discountMinor: result.discountMinor + line.discountMinor,
      taxMinor: result.taxMinor + line.taxMinor,
      totalMinor: result.totalMinor + line.totalMinor,
    }),
    {
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
    }
  );

  assertPostgresBigint(totals.subtotalMinor, 'Invoice subtotal');
  assertPostgresBigint(totals.discountMinor, 'Invoice discount');
  assertPostgresBigint(totals.taxMinor, 'Invoice tax');
  assertPostgresBigint(totals.totalMinor, 'Invoice total');
  return totals;
}

export function currencyFractionDigits(currency: string): number {
  const normalized = normalizeCurrency(currency);
  const fractionDigits = CURRENCY_FRACTION_DIGITS[normalized];
  if (fractionDigits === undefined) {
    throw new RangeError(`Unsupported invoice currency: ${normalized}`);
  }
  return fractionDigits;
}

export function minorUnitsToDecimal(
  value: MinorUnitsInput,
  fractionDigits: number
) {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new RangeError('Fraction digits must be an integer between 0 and 6');
  }

  const amount = parseMinorUnits(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const factor = 10n ** BigInt(fractionDigits);
  const whole = absolute / factor;
  const fraction = absolute % factor;
  const decimal = fractionDigits
    ? `${whole}.${fraction.toString().padStart(fractionDigits, '0')}`
    : whole.toString();
  return negative ? `-${decimal}` : decimal;
}

export function formatMinorUnits(
  value: MinorUnitsInput,
  currency: string,
  locale = 'en-US'
) {
  const normalizedCurrency = normalizeCurrency(currency);
  const fractionDigits = currencyFractionDigits(normalizedCurrency);
  const decimal = minorUnitsToDecimal(value, fractionDigits);
  const numeric = Number(decimal);

  if (Number.isFinite(numeric) && Math.abs(numeric) <= Number.MAX_SAFE_INTEGER) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(numeric);
  }

  return `${normalizedCurrency} ${decimal}`;
}
