<script lang="ts">
  import type { SessionViewModel } from "$shared/model/sessionViewModel";

  import Composer from "../features/composer/Composer.svelte";
  import ConversationView from "../features/conversation/ConversationView.svelte";
  import ExtensionUiHost from "../features/extension-ui/ExtensionUiHost.svelte";
  import ExtensionWidgets from "./ExtensionWidgets.svelte";
  import SessionMetrics from "./SessionMetrics.svelte";

  let { session, surfaceKind }: { session: SessionViewModel; surfaceKind: "sidebar" | "panel" } = $props();
  const aboveWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "above"));
  const belowWidgets = $derived(session.extensionWidgets.filter((widget) => widget.placement === "below"));
</script>

{#key session.id}<ConversationView {session} />{/key}
<div class="composer-region">
  <SessionMetrics {session} />
  <ExtensionWidgets widgets={aboveWidgets} />
  <ExtensionUiHost sessionId={session.id} requests={session.pendingExtensionUi} />
  <Composer {session} {surfaceKind} />
  <ExtensionWidgets widgets={belowWidgets} />
</div>
