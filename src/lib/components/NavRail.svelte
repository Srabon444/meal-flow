<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let { links }: { links: { href: string; label: string }[] } = $props();

  let mobileOpen = $state(false);

  function isActive(href: string) {
    return page.url.pathname === href;
  }

  async function signOut() {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
        }
      }
    } catch {
      // Best-effort cleanup - a push API failure here must never block sign-out.
    }
    await supabase.auth.signOut();
    await goto('/login');
  }
</script>

<header class="border-b border-line bg-paper" style="padding-top: env(safe-area-inset-top);">
  <div class="max-w-4xl mx-auto px-6 flex items-center justify-between h-16">
    <img src="/logo-mark.png" alt="MealFlow" class="h-9 w-9 rounded-lg" />

    <nav class="hidden md:flex items-center gap-1">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class="font-display text-xs tracking-widest uppercase px-3 py-2 border-b-2 transition-colors {isActive(
            link.href
          )
            ? 'border-stamp text-ink'
            : 'border-transparent text-ink/50 hover:text-ink'}"
        >
          {link.label}
        </a>
      {/each}
      <button
        onclick={signOut}
        class="font-display text-xs tracking-widest uppercase text-ink/50 hover:text-stamp transition-colors ml-2"
      >
        Sign out
      </button>
    </nav>

    <button
      onclick={() => (mobileOpen = !mobileOpen)}
      class="md:hidden flex flex-col gap-1.5 p-2 -mr-2"
      aria-label="Menu"
      aria-expanded={mobileOpen}
    >
      <span class="block w-5 h-0.5 bg-ink"></span>
      <span class="block w-5 h-0.5 bg-ink"></span>
      <span class="block w-5 h-0.5 bg-ink"></span>
    </button>
  </div>

  {#if mobileOpen}
    <nav class="md:hidden border-t border-line px-6 py-2">
      {#each links as link (link.href)}
        <a
          href={link.href}
          onclick={() => (mobileOpen = false)}
          class="block font-display text-xs tracking-widest uppercase py-3 border-b border-line last:border-b-0 {isActive(
            link.href
          )
            ? 'text-stamp'
            : 'text-ink/60'}"
        >
          {link.label}
        </a>
      {/each}
      <button
        onclick={() => {
          mobileOpen = false;
          signOut();
        }}
        class="block w-full text-left font-display text-xs tracking-widest uppercase py-3 text-ink/60"
      >
        Sign out
      </button>
    </nav>
  {/if}
</header>
