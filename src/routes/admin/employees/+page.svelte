<script lang="ts">
  import { supabase } from '$lib/supabase';

  let name = $state('');
  let email = $state('');
  let result = $state('');
  let error = $state('');

  async function createEmployee(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    result = '';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      error = 'not logged in';
      return;
    }

    const res = await fetch(`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/admin-create-employee`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, email })
    });

    const body = await res.json();
    if (!res.ok) {
      error = body.error ?? 'failed';
      return;
    }
    result = `Created ${body.email}`;
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
