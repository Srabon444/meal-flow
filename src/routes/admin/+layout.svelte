<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { initWebPush } from '$lib/push';

  let { children } = $props();

  const links = [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/rate', label: 'Rate' },
    { href: '/admin/cancel-requests', label: 'Requests' },
    { href: '/admin/employees', label: 'Employees' },
    { href: '/admin/reports', label: 'Reports' }
  ];

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) void initWebPush(userId);
  });
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
