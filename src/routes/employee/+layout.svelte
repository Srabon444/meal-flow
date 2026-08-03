<script lang="ts">
  import NavRail from '$lib/components/NavRail.svelte';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { initWebPush } from '$lib/push';
  import { initAndroidReminders } from '$lib/androidReminders';
  import { initFcm } from '$lib/fcm';

  let { children } = $props();

  const links = [
    { href: '/employee/dashboard', label: 'Dashboard' },
    { href: '/employee/history', label: 'History' },
    { href: '/employee/settings', label: 'Settings' }
  ];

  let stopAndroidReminders: () => void = () => {};
  let stopFcm: () => void = () => {};

  onMount(() => {
    const userId = page.data.profile?.id;
    if (userId) {
      initWebPush(userId).catch((e) => console.error('push init failed', e));
      stopAndroidReminders = initAndroidReminders(userId, 'employee');
      initFcm(userId)
        .then((stop) => (stopFcm = stop))
        .catch((e) => console.error('fcm init failed', e));
    }
  });
  onDestroy(() => {
    stopAndroidReminders();
    stopFcm();
  });
</script>

<div class="min-h-screen">
  <NavRail {links} />
  <main class="max-w-4xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
