<script lang="ts">
  let { status }: { status: string } = $props();
</script>
<span class={`status-dot status-${status}`} aria-label={status}></span>
