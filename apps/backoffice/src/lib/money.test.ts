import { describe, expect, it } from 'vitest';

import {
  calculateInvoiceTotals,
  calculateLineAmounts,
  currencyFractionDigits,
  minorUnitsToDecimal,
  normalizeCurrency,
  normalizeQuantity,
  parseMinorUnits,
} from './money';

describe('money helpers', () => {
  it('keeps minor units as bigint and rejects decimal input', () => {
    expect(parseMinorUnits('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(() => parseMinorUnits('10.50')).toThrow(/integer minor-unit/);
  });

  it('normalizes currencies and quantities', () => {
    expect(normalizeCurrency(' idr ')).toBe('IDR');
    expect(normalizeQuantity('12.340000')).toBe('12.34');
    expect(() => normalizeQuantity('0')).toThrow(/greater than zero/);
    expect(() => normalizeQuantity('1.0000001')).toThrow(/at most 6/);
  });

  it('rounds fractional minor units half up per line', () => {
    expect(
      calculateLineAmounts({ quantity: '0.5', unitPriceMinor: 1n })
    ).toMatchObject({ subtotalMinor: 1n, totalMinor: 1n });
  });

  it('applies discount before tax with deterministic basis-point rounding', () => {
    expect(
      calculateLineAmounts({
        quantity: '2.5',
        unitPriceMinor: 1_000n,
        discountMinor: 500n,
        taxRateBps: 1_100,
      })
    ).toEqual({
      quantity: '2.5',
      unitPriceMinor: 1_000n,
      discountMinor: 500n,
      taxRateBps: 1_100,
      subtotalMinor: 2_500n,
      taxMinor: 220n,
      totalMinor: 2_220n,
    });
  });

  it('sums invoice totals without converting through number', () => {
    const first = calculateLineAmounts({ quantity: '1', unitPriceMinor: 100n });
    const second = calculateLineAmounts({
      quantity: '2',
      unitPriceMinor: 250n,
      discountMinor: 50n,
      taxRateBps: 1_000,
    });

    expect(calculateInvoiceTotals([first, second])).toEqual({
      subtotalMinor: 600n,
      discountMinor: 50n,
      taxMinor: 45n,
      totalMinor: 595n,
    });
  });

  it('formats exact decimal strings for zero and two-decimal currencies', () => {
    expect(currencyFractionDigits('IDR')).toBe(0);
    expect(currencyFractionDigits('USD')).toBe(2);
    expect(minorUnitsToDecimal(12_345n, 0)).toBe('12345');
    expect(minorUnitsToDecimal(-12_345n, 2)).toBe('-123.45');
  });
});
