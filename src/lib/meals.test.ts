import { describe, it, expect } from 'vitest';
import { pickActiveRate, computeBalance, localToday, computeBalancesByUser } from './meals';

describe('pickActiveRate', () => {
  it('returns null when no rates exist', () => {
    expect(pickActiveRate([], '2026-08-01')).toBeNull();
  });

  it('returns null when all rates start after today', () => {
    expect(
      pickActiveRate([{ rate: 100, effective_from: '2026-09-01', created_at: 'a' }], '2026-08-01')
    ).toBeNull();
  });

  it('picks the most recent rate that has already started', () => {
    const rates = [
      { rate: 100, effective_from: '2026-01-01', created_at: 'a' },
      { rate: 120, effective_from: '2026-07-01', created_at: 'b' },
      { rate: 150, effective_from: '2026-09-01', created_at: 'c' }
    ];
    expect(pickActiveRate(rates, '2026-08-01')).toBe(120);
  });

  it('breaks effective_from ties on created_at, regardless of input order', () => {
    const older = { rate: 100, effective_from: '2026-07-01', created_at: '2026-06-01T00:00:00Z' };
    const newer = { rate: 120, effective_from: '2026-07-01', created_at: '2026-06-02T00:00:00Z' };
    expect(pickActiveRate([older, newer], '2026-08-01')).toBe(120);
    expect(pickActiveRate([newer, older], '2026-08-01')).toBe(120);
  });

  it('includes a rate whose effective_from is exactly today', () => {
    const rates = [{ rate: 90, effective_from: '2026-08-01', created_at: 'a' }];
    expect(pickActiveRate(rates, '2026-08-01')).toBe(90);
  });
});

describe('localToday', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

describe('computeBalancesByUser', () => {
  it('groups entries and payments by user_id independently', () => {
    const entries = [
      { user_id: 'a', rate_applied: 100, status: 'CONFIRMED' },
      { user_id: 'b', rate_applied: 200, status: 'CONFIRMED' },
      { user_id: 'a', rate_applied: 100, status: 'CANCELLED' }
    ];
    const payments = [{ user_id: 'a', amount: 50 }];
    const result = computeBalancesByUser(entries, payments);
    expect(result['a']).toEqual({ totalEaten: 1, totalCost: 100, totalPaid: 50, due: 50 });
    expect(result['b']).toEqual({ totalEaten: 1, totalCost: 200, totalPaid: 0, due: 200 });
  });

  it('includes a user who only has payments and no entries', () => {
    const result = computeBalancesByUser([], [{ user_id: 'c', amount: 30 }]);
    expect(result['c']).toEqual({ totalEaten: 0, totalCost: 0, totalPaid: 30, due: -30 });
  });
});
