<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type CancelRequestRow = {
    id: string;
    meal_entry_id: string;
    requested_by: string;
    reason: string | null;
    created_at: string;
  };

  let requests = $state<CancelRequestRow[]>([]);
  let entryDates = $state<Record<string, string>>({});
  let names = $state<Record<string, string>>({});
  let loading = $state(true);
  let loadError = $state('');
  let actingId = $state<string | null>(null);
  let error = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data: reqData, error: reqError } = await supabase
      .from('cancel_requests')
      .select('id, meal_entry_id, requested_by, reason, created_at')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true });
    if (reqError) {
      loadError = reqError.message;
      loading = false;
      return;
    }
    requests = reqData ?? [];

    const entryIds = [...new Set(requests.map((r) => r.meal_entry_id))];
    const userIds = [...new Set(requests.map((r) => r.requested_by))];

    const [entriesRes, profilesRes] = await Promise.all([
      entryIds.length
        ? supabase.from('meal_entries').select('id, entry_date').in('id', entryIds)
        : Promise.resolve({ data: [] as { id: string; entry_date: string }[] }),
      userIds.length
        ? supabase.from('profiles').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] })
    ]);

    entryDates = Object.fromEntries((entriesRes.data ?? []).map((e) => [e.id, e.entry_date]));
    names = Object.fromEntries((profilesRes.data ?? []).map((p) => [p.id, p.name]));
    loading = false;
  }

  onMount(load);

  async function act(id: string, fn: 'approve_cancel_request' | 'reject_cancel_request') {
    actingId = id;
    error = '';
    const { error: rpcError } = await supabase.rpc(fn, { request_id: id });
    actingId = null;
    if (rpcError) {
      error = rpcError.message;
      return;
    }
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Requests</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Cancel requests</h1>
</div>

{#if error}<p class="mb-4 text-sm text-stamp-dark">{error}</p>{/if}

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else if requests.length === 0}
  <p class="text-sm text-ink/50">No pending requests.</p>
{:else}
  <ul class="divide-y divide-line border-t border-b border-line">
    {#each requests as req (req.id)}
      <li class="py-3 flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">
            {names[req.requested_by] ?? 'Unknown'} — {entryDates[req.meal_entry_id] ?? '—'}
          </p>
          {#if req.reason}<p class="text-xs text-ink/50">{req.reason}</p>{/if}
        </div>
        <div class="flex items-center gap-3">
          <button
            onclick={() => act(req.id, 'approve_cancel_request')}
            disabled={actingId === req.id}
            class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onclick={() => act(req.id, 'reject_cancel_request')}
            disabled={actingId === req.id}
            class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </li>
    {/each}
  </ul>
{/if}
