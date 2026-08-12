<script lang="ts">
  import { page } from '$app/state';
  import MealOrderCard from '$lib/components/MealOrderCard.svelte';
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Today</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Welcome, {page.data.profile?.name}</h1>
</div>

<MealOrderCard userId={page.data.profile?.id} />
