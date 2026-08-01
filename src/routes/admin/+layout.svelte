<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';

  let { children } = $props();

  const links = [
    { href: '/admin/dashboard', label: 'Dashboard' },
    { href: '/admin/rate', label: 'Rate' },
    { href: '/admin/cancel-requests', label: 'Requests' },
    { href: '/admin/employees', label: 'Employees' }
  ];
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
