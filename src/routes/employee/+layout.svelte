<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' }
  ];
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
