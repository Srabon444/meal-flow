export type Rate = { rate: number; effective_from: string; created_at: string };
export type Entry = { rate_applied: number; status: string };
export type Payment = { amount: number };
export type Balance = { totalEaten: number; totalCost: number; totalPaid: number; due: number };

export function pickActiveRate(rates: Rate[], today: string): number | null {
  const applicable = rates.filter((r) => r.effective_from <= today);
  if (applicable.length === 0) return null;
  // Newest effective_from wins; same-day rates tie-break on created_at so the
  // result doesn't depend on the order the rows came back in.
  applicable.sort((a, b) => {
    if (a.effective_from !== b.effective_from) return a.effective_from < b.effective_from ? 1 : -1;
    return a.created_at < b.created_at ? 1 : -1;
  });
  return applicable[0].rate;
}

/** Today as YYYY-MM-DD in the browser's local timezone (en-CA is ISO-shaped). */
export function localToday(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function computeBalance(entries: Entry[], payments: Payment[]): Balance {
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const totalEaten = confirmed.length;
  const totalCost = confirmed.reduce((sum, e) => sum + e.rate_applied, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  return { totalEaten, totalCost, totalPaid, due: totalCost - totalPaid };
}

export function computeBalancesByUser(
  entries: (Entry & { user_id: string })[],
  payments: (Payment & { user_id: string })[]
): Record<string, Balance> {
  const userIds = new Set([...entries.map((e) => e.user_id), ...payments.map((p) => p.user_id)]);
  const result: Record<string, Balance> = {};
  for (const id of userIds) {
    result[id] = computeBalance(
      entries.filter((e) => e.user_id === id),
      payments.filter((p) => p.user_id === id)
    );
  }
  return result;
}
