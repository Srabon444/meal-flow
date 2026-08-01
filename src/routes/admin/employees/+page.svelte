<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { FunctionsHttpError } from '@supabase/supabase-js';
  import { onMount } from 'svelte';
  import type { Balance } from '$lib/meals';

  type Employee = { id: string; name: string; email: string | null; createdAt: string };

  let name = $state('');
  let email = $state('');
  let created = $state<{ email: string; tempPassword: string } | null>(null);
  let error = $state('');
  let loading = $state(false);

  let employees = $state<Employee[]>([]);
  let balances = $state<Record<string, Balance>>({});
  let listLoading = $state(true);
  let listError = $state('');
  let removingId = $state<string | null>(null);
  let removeError = $state('');

  let payingId = $state<string | null>(null);
  let paymentAmount = $state('');
  let paymentNote = $state('');
  let paymentSubmitting = $state(false);
  let paymentError = $state('');

  async function messageFor(err: Error): Promise<string> {
    if (err instanceof FunctionsHttpError) {
      const body = await err.context.json().catch(() => null);
      if (body?.error) return body.error;
    }
    return err.message;
  }

  async function loadEmployees() {
    listLoading = true;
    listError = '';
    const { data, error: invokeError } = await supabase.functions.invoke<{ employees: Employee[] }>(
      'admin-list-employees',
      { method: 'GET' }
    );
    if (invokeError) {
      listLoading = false;
      listError = await messageFor(invokeError);
      return;
    }
    employees = data?.employees ?? [];

    // Aggregated in Postgres, not here: fetching every meal_entries/payments row
    // silently truncated at PostgREST's max_rows (1000) and under-reported dues.
    const { data: balanceRows, error: balanceError } = await supabase.rpc('employee_balances');
    if (balanceError) {
      listError = balanceError.message;
      listLoading = false;
      return;
    }
    balances = Object.fromEntries(
      (balanceRows ?? []).map((r) => [
        r.user_id,
        {
          totalEaten: r.total_eaten,
          totalCost: Number(r.total_cost),
          totalPaid: Number(r.total_paid),
          due: Number(r.total_cost) - Number(r.total_paid)
        }
      ])
    );
    listLoading = false;
  }

  onMount(loadEmployees);

  async function createEmployee(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    created = null;
    loading = true;

    const { data, error: invokeError } = await supabase.functions.invoke<{
      id: string;
      email: string;
      tempPassword: string;
    }>('admin-create-employee', { body: { name, email } });

    loading = false;
    if (invokeError) {
      error = await messageFor(invokeError);
      return;
    }
    created = { email: data!.email, tempPassword: data!.tempPassword };
    name = '';
    email = '';
    await loadEmployees();
  }

  function addAnother() {
    created = null;
  }

  async function confirmRemove(id: string) {
    removeError = '';
    const { error: invokeError } = await supabase.functions.invoke('admin-delete-employee', {
      body: { id }
    });
    removingId = null;
    if (invokeError) {
      removeError = await messageFor(invokeError);
      return;
    }
    employees = employees.filter((emp) => emp.id !== id);
  }

  function startPayment(id: string) {
    payingId = id;
    paymentAmount = '';
    paymentNote = '';
    paymentError = '';
  }

  async function submitPayment(id: string) {
    if (paymentSubmitting) return;
    paymentError = '';
    // min="0" on the input is inert - these fields aren't in a <form> and Save
    // is a plain onclick, so nothing validates. Mirrored by a DB check constraint.
    if (!(Number(paymentAmount) > 0)) {
      paymentError = 'Enter an amount greater than 0.';
      return;
    }
    paymentSubmitting = true;
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      paymentError = 'Session expired — sign in again.';
      paymentSubmitting = false;
      return;
    }
    const { error: insertError } = await supabase
      .from('payments')
      .insert({ user_id: id, amount: Number(paymentAmount), note: paymentNote || null, recorded_by: user.id });
    paymentSubmitting = false;
    if (insertError) {
      paymentError = insertError.message;
      return;
    }
    payingId = null;
    await loadEmployees();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Roster</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Employees</h1>
</div>

<div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
  <div>
    {#if created}
      <div class="ticket pt-8 pb-6 px-6">
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-3">Account created</p>
        <dl class="space-y-3 text-sm">
          <div>
            <dt class="font-display text-[11px] tracking-widest text-ink/50 uppercase">Email</dt>
            <dd class="mt-0.5">{created.email}</dd>
          </div>
          <div>
            <dt class="font-display text-[11px] tracking-widest text-ink/50 uppercase">Temporary password</dt>
            <dd class="mt-0.5 font-display">{created.tempPassword}</dd>
          </div>
        </dl>
        <p class="mt-4 text-xs text-ink/60">
          Share this with the employee directly — it won't be shown again. They can change it
          themselves from Settings after signing in.
        </p>
        <div class="ticket-tear mt-6 pt-4">
          <button
            onclick={addAnother}
            class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors"
          >
            Add another →
          </button>
        </div>
      </div>
    {:else}
      <form onsubmit={createEmployee} class="ticket pt-8 pb-6 px-6">
        <div class="space-y-4">
          <label class="block">
            <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Name</span>
            <input
              bind:value={name}
              placeholder="Jane Doe"
              class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
              required
            />
          </label>
          <label class="block">
            <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Email</span>
            <input
              type="email"
              bind:value={email}
              placeholder="jane@company.com"
              class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
              required
            />
          </label>
        </div>

        {#if error}
          <p class="mt-4 text-sm text-stamp-dark">{error}</p>
        {/if}

        <div class="ticket-tear mt-6 pt-4 flex items-center justify-between">
          <span class="font-display text-[11px] tracking-widest text-ink/40 uppercase">No. 002</span>
          <button
            type="submit"
            disabled={loading}
            class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create employee →'}
          </button>
        </div>
      </form>
    {/if}
  </div>

  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">
      {employees.length} on staff
    </p>

    {#if removeError}
      <p class="mb-3 text-sm text-stamp-dark">{removeError}</p>
    {/if}
    {#if paymentError}
      <p class="mb-3 text-sm text-stamp-dark">{paymentError}</p>
    {/if}

    {#if listLoading}
      <p class="text-sm text-ink/50">Loading…</p>
    {:else if listError}
      <p class="text-sm text-stamp-dark">{listError}</p>
    {:else if employees.length === 0}
      <p class="text-sm text-ink/50">No employees yet — add one to get started.</p>
    {:else}
      <ul class="divide-y divide-line border-t border-b border-line">
        {#each employees as emp (emp.id)}
          {@const bal = balances[emp.id]}
          <li class="py-3">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm font-medium">{emp.name}</p>
                <p class="text-xs text-ink/50">{emp.email ?? '—'}</p>
                <p class="text-xs text-ink/50">
                  eaten {bal?.totalEaten ?? 0} · due {(bal?.due ?? 0).toFixed(2)}
                </p>
              </div>
              <div class="flex items-center gap-3">
                {#if payingId !== emp.id}
                  <button
                    onclick={() => startPayment(emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70"
                  >
                    Record payment
                  </button>
                {/if}
                {#if removingId === emp.id}
                  <span class="font-display text-[11px] tracking-widest text-stamp uppercase">Remove?</span>
                  <button
                    onclick={() => confirmRemove(emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark"
                  >
                    Confirm
                  </button>
                  <button
                    onclick={() => (removingId = null)}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink"
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    onclick={() => (removingId = emp.id)}
                    class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-stamp transition-colors"
                  >
                    Remove
                  </button>
                {/if}
              </div>
            </div>
            {#if payingId === emp.id}
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  bind:value={paymentAmount}
                  placeholder="Amount"
                  class="w-24 border-b-2 border-line bg-transparent py-1 text-sm outline-none focus:border-stamp transition-colors"
                />
                <input
                  bind:value={paymentNote}
                  placeholder="Note (optional)"
                  class="min-w-0 flex-1 border-b-2 border-line bg-transparent py-1 text-sm outline-none focus:border-stamp transition-colors"
                />
                <button
                  onclick={() => submitPayment(emp.id)}
                  disabled={paymentSubmitting}
                  class="font-display text-[11px] tracking-widest uppercase text-sage hover:opacity-70 disabled:opacity-50"
                >
                  {paymentSubmitting ? 'Saving…' : 'Save'}
                </button>
                <button
                  onclick={() => (payingId = null)}
                  disabled={paymentSubmitting}
                  class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
