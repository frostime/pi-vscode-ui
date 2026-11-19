import type { ImageAttachmentView, MessageBlockView } from "../../shared/model/conversationModel.js";
import { isShellTool } from "../../shared/model/shellTools.js";
import type { BoundToolCallView } from "../../shared/model/toolCallModel.js";

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

export function createToolView(id: string, name: string, args: Record<string, unknown>, startedAt = Date.now()): BoundToolCallView {
  const filePath = toolFilePath(args);
  const line = numericValue(args.line) ?? numericValue(args.start_line) ?? numericValue(args.startLine);
  const recognized = filePath
    ? { location: { path: filePath, ...(line ? { line } : {}) } }
    : undefined;
  return {
    state: "bound",
    id,
    name,
    label: toolLabel(name, args),
    status: "running",
    args,
    isError: false,
    startedAt,
    ...(recognized ? { recognized } : {}),
  };
}

const TOOL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function extractToolOutput(
  result: unknown,
  toolCallId: string,
  maxTextChars: number,
  maxImages: number,
  maxImageBytes: number,
): { output: string; images: ImageAttachmentView[] } {
  const content = isRecord(result) ? result.content : result;
  const images: ImageAttachmentView[] = [];
  const text: string[] = [];
  if (typeof content === "string") text.push(content);
  let imageCount = 0;
  for (const part of arrayValue(content)) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string" && part.text) text.push(part.text);
    if (part.type !== "image") continue;
    imageCount++;
    const { data, mimeType } = part;
    if (images.length >= maxImages || typeof data !== "string" || typeof mimeType !== "string"
        || !TOOL_IMAGE_TYPES.has(mimeType) || data.length > 4 * Math.ceil(maxImageBytes / 3)
        || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
    const size = Buffer.byteLength(data, "base64");
    if (size > maxImageBytes) continue;
    images.push({
      id: `${toolCallId}-image-${imageCount}`,
      name: stringValue(part.fileName, `Image ${imageCount}`),
      mimeType,
      dataUrl: `data:${mimeType};base64,${data}`,
      size,
    });
  }
  const omitted = imageCount - images.length;
  if (omitted > 0) text.push(omitted === 1 ? "1 image could not be displayed." : `${omitted} images could not be displayed.`);
  return { output: text.join("\n").slice(-maxTextChars), images };
}

export function extractToolDiff(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.details)) return undefined;
  const diff = value.details.diff;
  return typeof diff === "string" && diff.length > 0 ? diff.slice(0, 160_000) : undefined;
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
  if (isShellTool(name) && typeof args.command === "string") return args.command;
  const path = toolFilePath(args);
  if (path) return path;
  if (name === "grep" && typeof args.pattern === "string") return args.pattern;
  return name;
}
