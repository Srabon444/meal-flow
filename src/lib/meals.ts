export type Rate = { rate: number; effective_from: string };
export type Entry = { rate_applied: number; status: string };
export type Payment = { amount: number };
export type Balance = { totalEaten: number; totalCost: number; totalPaid: number; due: number };

export function pickActiveRate(rates: Rate[], today: string): number | null {
  const applicable = rates.filter((r) => r.effective_from <= today);
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return applicable[0].rate;
}

export function computeBalance(entries: Entry[], payments: Payment[]): Balance {
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const totalEaten = confirmed.length;
  const totalCost = confirmed.reduce((sum, e) => sum + e.rate_applied, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  return { totalEaten, totalCost, totalPaid, due: totalCost - totalPaid };
}
