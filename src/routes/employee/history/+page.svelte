<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type Entry = { id: string; entry_date: string; status: string; rate_applied: number };
  type CancelRequest = {
    id: string;
    meal_entry_id: string;
    status: string;
    reason: string | null;
    created_at: string;
  };
  type Payment = { id: string; amount: number; note: string | null; paid_at: string };
  type Row =
    | { kind: 'meal'; date: string; entry: Entry }
    | { kind: 'payment'; date: string; payment: Payment };

  const userId = page.data.profile?.id as string;

  let entries = $state<Entry[]>([]);
  let payments = $state<Payment[]>([]);
  let requests = $state<CancelRequest[]>([]);
  let loading = $state(true);
  let requestingId = $state<string | null>(null);
  let reason = $state('');
  let error = $state('');
  let loadError = $state('');
  let submitting = $state(false);

  let rows = $derived.by((): Row[] => {
    const meals: Row[] = entries.map((entry) => ({ kind: 'meal' as const, date: entry.entry_date, entry }));
    const pays: Row[] = payments.map((payment) => ({
      kind: 'payment' as const,
      date: payment.paid_at,
      payment
    }));
    return [...meals, ...pays].sort((a, b) => (a.date < b.date ? 1 : -1));
  });

  async function load() {
    loading = true;
    loadError = '';
    const [entriesRes, paymentsRes, requestsRes] = await Promise.all([
      supabase
        .from('meal_entries')
        .select('id, entry_date, status, rate_applied')
        .eq('user_id', userId)
        .order('entry_date', { ascending: false }),
      supabase
        .from('payments')
        .select('id, amount, note, paid_at')
        .eq('user_id', userId)
        .order('paid_at', { ascending: false }),
      supabase
        .from('cancel_requests')
        .select('id, meal_entry_id, status, reason, created_at')
        .eq('requested_by', userId)
        .order('created_at', { ascending: false })
    ]);
    const failed = [entriesRes.error, paymentsRes.error, requestsRes.error].find(Boolean);
    if (failed) {
      loadError = failed.message;
      loading = false;
      return;
    }
    entries = entriesRes.data ?? [];
    payments = paymentsRes.data ?? [];
    requests = requestsRes.data ?? [];
    loading = false;
  }

  onMount(load);

  function requestedFor(entryId: string) {
    return requests.find((r) => r.meal_entry_id === entryId);
  }

  function startRequest(entryId: string) {
    requestingId = entryId;
    reason = '';
    error = '';
  }

  async function submitRequest(entryId: string) {
    if (submitting) return;
    submitting = true;
    error = '';
    const { error: insertError } = await supabase
      .from('cancel_requests')
      .insert({ meal_entry_id: entryId, requested_by: userId, reason: reason || null });
    submitting = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    requestingId = null;
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">History</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Your meal entries</h1>
</div>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else if rows.length === 0}
  <p class="text-sm text-ink/50">No entries yet.</p>
{:else}
  <ul class="divide-y divide-line border-t border-b border-line">
    {#each rows as row (row.kind === 'meal' ? `meal-${row.entry.id}` : `payment-${row.payment.id}`)}
      {#if row.kind === 'payment'}
        <li class="py-3 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">{row.payment.paid_at.slice(0, 10)}</p>
            <p class="text-xs text-ink/50">{row.payment.note ?? 'Payment'}</p>
          </div>
          <p class="text-sm text-sage">+{row.payment.amount.toFixed(2)}</p>
        </li>
      {:else}
        {@const entry = row.entry}
        {@const existingRequest = requestedFor(entry.id)}
        <li class="py-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-sm font-medium">{entry.entry_date}</p>
              <p class="text-xs text-ink/50">
                {entry.status} · charged {entry.rate_applied.toFixed(2)}
                {#if existingRequest}· cancel {existingRequest.status.toLowerCase()}{/if}
              </p>
            </div>
            {#if entry.status === 'CONFIRMED' && !existingRequest}
              {#if requestingId === entry.id}
                <div class="flex items-center gap-2">
                  <button
                    onclick={() => submitRequest(entry.id)}
                    disabled={submitting}
                    class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark disabled:opacity-50"
                  >
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>
                  <button
                    onclick={() => (requestingId = null)}
                    disabled={submitting}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <button
                  onclick={() => startRequest(entry.id)}
                  class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-stamp transition-colors"
                >
                  Request cancellation
                </button>
              {/if}
            {/if}
          </div>
          {#if requestingId === entry.id}
            <textarea
              bind:value={reason}
              placeholder="Reason (optional)"
              class="mt-2 w-full border-b-2 border-line bg-transparent py-2 text-sm outline-none focus:border-stamp transition-colors"
              rows="2"
            ></textarea>
            {#if error}<p class="mt-2 text-sm text-stamp-dark">{error}</p>{/if}
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/if}
