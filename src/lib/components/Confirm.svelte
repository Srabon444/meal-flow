<script lang="ts">
  let {
    open,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel
  }: {
    open: boolean;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6"
    role="presentation"
    onclick={onCancel}
    onkeydown={(e) => e.key === 'Escape' && onCancel()}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="ticket w-full max-w-xs pt-8 pb-6 px-6 text-center"
      role="alertdialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <p class="text-sm mb-6">{message}</p>
      <div class="flex items-center justify-center gap-6">
        <button
          onclick={onCancel}
          class="font-display text-[11px] tracking-widest uppercase text-ink/40 hover:text-ink"
        >
          {cancelLabel}
        </button>
        <button
          onclick={onConfirm}
          class="font-display text-[11px] tracking-widest uppercase text-stamp hover:text-stamp-dark"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
