import type { MessageBlockView } from "$shared/model/conversationModel";

import { postToHost } from "../../bridge/hostBridge";

export function copyMessageText(blocks: readonly MessageBlockView[]): void {
  const text = rawMessageText(blocks);
  if (text) postToHost({ type: "copyText", text });
}

export function rawMessageText(blocks: readonly MessageBlockView[]): string {
  return blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
}
