import { describe, it, expect } from 'vitest';
import { pickActiveRate, computeBalance } from './meals';

describe('pickActiveRate', () => {
  it('returns null when no rates exist', () => {
    expect(pickActiveRate([], '2026-08-01')).toBeNull();
  });

  it('returns null when all rates start after today', () => {
    expect(pickActiveRate([{ rate: 100, effective_from: '2026-09-01' }], '2026-08-01')).toBeNull();
  });

  it('picks the most recent rate that has already started', () => {
    const rates = [
      { rate: 100, effective_from: '2026-01-01' },
      { rate: 120, effective_from: '2026-07-01' },
      { rate: 150, effective_from: '2026-09-01' }
    ];
    expect(pickActiveRate(rates, '2026-08-01')).toBe(120);
  });
});

describe('computeBalance', () => {
  it('returns zeros with no entries or payments', () => {
    expect(computeBalance([], [])).toEqual({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  });

  it('only counts CONFIRMED entries toward eaten/cost', () => {
    const entries = [
      { rate_applied: 100, status: 'CONFIRMED' },
      { rate_applied: 100, status: 'CANCELLED' }
    ];
    expect(computeBalance(entries, [])).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 0, due: 100 });
  });

  it('subtracts total payments from total cost to get due', () => {
    const entries = [{ rate_applied: 100, status: 'CONFIRMED' }];
    const payments = [{ amount: 60 }];
    expect(computeBalance(entries, payments)).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 60, due: 40 });
  });
});
