import type { ImageAttachmentView, MessageBlockView } from "../../shared/model/conversationModel.js";
import type { ToolCallView } from "../../shared/model/toolCallModel.js";

export function contentToBlocks(content: unknown, attachments: unknown, idPrefix: string): MessageBlockView[] {
  const blocks: MessageBlockView[] = [];
  let imageIndex = 0;

  if (typeof content === "string") {
    if (content) blocks.push({ type: "text", text: content });
  } else {
    for (const part of arrayValue(content)) {
      if (!isRecord(part)) continue;
      if (part.type === "text" && typeof part.text === "string") {
        blocks.push({ type: "text", text: part.text });
      } else if (part.type === "thinking" && typeof part.thinking === "string") {
        blocks.push({ type: "thinking", text: part.thinking });
      } else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
        appendImage(blocks, imageView(part, part.data, idPrefix, imageIndex++));
      }
    }
  }

  for (const attachment of arrayValue(attachments)) {
    if (!isRecord(attachment) || attachment.type !== "image" || typeof attachment.content !== "string" || typeof attachment.mimeType !== "string") continue;
    appendImage(blocks, imageView(attachment, attachment.content, idPrefix, imageIndex++));
  }

  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

// pi-084-message-streaming::shape — this factory will create only the bound-tool variant.
export function createToolView(id: string, name: string, args: Record<string, unknown>, startedAt = Date.now()): ToolCallView {
  const filePath = toolFilePath(args);
  const line = numericValue(args.line) ?? numericValue(args.start_line) ?? numericValue(args.startLine);
  return {
    id,
    name,
    label: toolLabel(name, args),
    status: "running",
    args,
    isError: false,
    startedAt,
    ...(filePath ? { filePath } : {}),
    ...(line ? { line } : {}),
  };
}

export function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && Array.isArray(value.content)) return extractText(value.content);
  if (Array.isArray(value)) {
    return value
      .map((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function appendImage(blocks: MessageBlockView[], image: ImageAttachmentView): void {
  const previous = blocks.at(-1);
  if (previous?.type === "images") previous.images.push(image);
  else blocks.push({ type: "images", images: [image] });
}

function imageView(
  raw: Record<string, unknown>,
  data: string,
  idPrefix: string,
  imageIndex: number,
): ImageAttachmentView {
  const mimeType = stringValue(raw.mimeType, "image/png");
  return {
    id: stringValue(raw.id, `${idPrefix}-image-${imageIndex + 1}`),
    name: stringValue(raw.fileName, "image"),
    mimeType,
    dataUrl: `data:${mimeType};base64,${data}`,
    size: typeof raw.size === "number" ? raw.size : Buffer.byteLength(data, "base64"),
  };
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolFilePath(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path", "filePath", "filename"]) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function toolLabel(name: string, args: Record<string, unknown>): string {
  if (name === "bash" && typeof args.command === "string") return args.command;
  const path = toolFilePath(args);
  if (path) return path;
  if (name === "grep" && typeof args.pattern === "string") return args.pattern;
  return name;
}
