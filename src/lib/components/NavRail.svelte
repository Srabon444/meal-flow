<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let { links }: { links: { href: string; label: string }[] } = $props();

  function isActive(href: string) {
    return page.url.pathname === href;
  }

  async function signOut() {
    await supabase.auth.signOut();
    await goto('/login');
  }
</script>

<header class="border-b border-line bg-paper">
  <div class="max-w-4xl mx-auto px-6 flex items-center justify-between h-16">
    <span class="font-display font-bold text-sm tracking-wide">OFFICEMEAL</span>

    <nav class="flex items-center gap-1">
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
    </nav>

    <button
      onclick={signOut}
      class="font-display text-xs tracking-widest uppercase text-ink/50 hover:text-stamp transition-colors"
    >
      Sign out
    </button>
  </div>
</header>
