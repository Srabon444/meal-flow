<script lang="ts">
  import { authStore } from '$lib/stores/auth';
</script>

<h1 class="text-xl p-6">Welcome, {$authStore.profile?.name}. Employee dashboard coming in sub-project 2.</h1>
