import { postToHost } from "../../../bridge/hostBridge";

export function activateTranscriptLink(event: MouseEvent | KeyboardEvent): void {
  if (event instanceof KeyboardEvent ? event.key !== "Enter" || event.repeat : event.button !== 0) return;
  const element = event.target instanceof Element ? event.target.closest("[data-transcript-url]") : null;
  const url = element?.getAttribute("data-transcript-url");
  if (!url) return;
  event.preventDefault();
  event.stopPropagation();
  postToHost({ type: "openTranscriptLink", url });
}
