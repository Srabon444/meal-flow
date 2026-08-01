<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { FunctionsHttpError } from '@supabase/supabase-js';

  let name = $state('');
  let email = $state('');
  let result = $state('');
  let error = $state('');

  // invoke() collapses every non-2xx into the same generic message; the useful one
  // ("forbidden", "email already registered", ...) is in the un-read response body.
  async function messageFor(err: Error): Promise<string> {
    if (err instanceof FunctionsHttpError) {
      const body = await err.context.json().catch(() => null);
      if (body?.error) return body.error;
    }
    return err.message;
  }

  async function createEmployee(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    result = '';

    // invoke() derives the URL from the configured client and attaches the current
    // session's Authorization header itself.
    const { data, error: invokeError } = await supabase.functions.invoke<{
      id: string;
      email: string;
      tempPassword: string;
    }>('admin-create-employee', { body: { name, email } });

    if (invokeError) {
      error = await messageFor(invokeError);
      return;
    }
    result = `Created ${data?.email} — temporary password: ${data?.tempPassword} (share with the employee; they should change it after first login)`;
    name = '';
    email = '';
  }
</script>

<form onsubmit={createEmployee} class="max-w-sm mx-auto mt-10 space-y-4">
  <h1 class="text-xl font-semibold">Add employee</h1>
  <input bind:value={name} placeholder="Name" class="border p-2 w-full" required />
  <input type="email" bind:value={email} placeholder="Email" class="border p-2 w-full" required />
  {#if error}<p class="text-red-600 text-sm">{error}</p>{/if}
  {#if result}<p class="text-green-600 text-sm">{result}</p>{/if}
  <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full">Create</button>
</form>
