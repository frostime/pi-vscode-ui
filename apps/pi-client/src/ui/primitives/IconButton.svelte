<script lang="ts">
  let {
    icon,
    label,
    disabled = false,
    active = false,
    onclick,
    type = "button",
  }: {
    icon: string;
    label: string;
    disabled?: boolean;
    active?: boolean;
    onclick?: () => void;
    type?: "button" | "submit";
  } = $props();
</script>

<button class:active class="icon-button" {disabled} {type} aria-label={label} title={label} onclick={onclick}>
  <span class={`codicon codicon-${icon}`} aria-hidden="true"></span>
</button>
