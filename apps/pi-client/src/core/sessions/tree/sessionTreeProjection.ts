import type { RpcSessionEntry } from "@frostime/pi-rpc";

import type { ImageAttachmentView } from "../../../shared/model/conversationModel.js";
import type { ActiveBranchEdge } from "../../conversation/ConversationProjection.js";
import type { SessionEntryIndex } from "../SessionEntryState.js";

export interface SessionTreeIndex {
  entriesById: ReadonlyMap<string, RpcSessionEntry>;
  childrenById: ReadonlyMap<string | null, readonly string[]>;
  parentById: ReadonlyMap<string, string | null>;
  activePath: readonly string[];
  leafId: string | null;
}

export interface BranchEndChoiceProjection {
  targetId: string;
  label: string;
  description: string;
  detail: string;
  isCurrent: boolean;
  isEditable: boolean;
  messageCount: number;
  updatedAt: number;
}

export interface EditableTargetProjection {
  entryId: string;
  text: string;
  images: ImageAttachmentView[];
}

const PREVIEW_LENGTH = 80;
const DETAIL_LENGTH = 72;

export function buildSessionTreeIndex(
  entries: readonly RpcSessionEntry[],
  leafId: string | null,
): SessionTreeIndex {
  const entriesById = new Map<string, RpcSessionEntry>();
  for (const entry of entries) {
    if (entry.id && !entriesById.has(entry.id)) entriesById.set(entry.id, entry);
  }

  const parentById = new Map<string, string | null>();
  for (const entry of entriesById.values()) parentById.set(entry.id, safeParentId(entry, entriesById));

  const childrenById = new Map<string | null, string[]>();
  childrenById.set(null, []);
  for (const entry of entriesById.values()) {
    const parentId = parentById.get(entry.id) ?? null;
    childrenById.set(parentId, [...(childrenById.get(parentId) ?? []), entry.id]);
    if (!childrenById.has(entry.id)) childrenById.set(entry.id, []);
  }

  const activePath = activeEntryPath(leafId, entriesById, parentById);
  return {
    entriesById,
    childrenById,
    parentById,
    activePath,
    leafId: activePath.at(-1) ?? null,
  };
}

export function projectActiveBranchEdges(index: SessionEntryIndex): ActiveBranchEdge[] {
  const edges: ActiveBranchEdge[] = [];
  const rootEntryId = index.activePath[0];
  if (rootEntryId && retainedChildren(index, null).length >= 2) {
    edges.push({
      branchPointId: null,
      activeChildEntryId: rootEntryId,
      pathCount: reachablePathCount(index, null),
    });
  }

  for (let pathIndex = 0; pathIndex < index.activePath.length - 1; pathIndex++) {
    const branchPointId = index.activePath[pathIndex];
    const activeChildEntryId = index.activePath[pathIndex + 1];
    if (!branchPointId || !activeChildEntryId || retainedChildren(index, branchPointId).length < 2) continue;
    edges.push({
      branchPointId,
      activeChildEntryId,
      pathCount: reachablePathCount(index, branchPointId),
    });
  }
  return edges;
}

export function projectBranchEndChoices(
  index: SessionTreeIndex,
  branchPointId: string | null,
): BranchEndChoiceProjection[] {
  if (branchPointId !== null && !index.entriesById.has(branchPointId)) return [];
  const descendants = new Set(descendantIds(index, branchPointId));
  if (descendants.size === 0) return [];

  const endIds = [...descendants].filter((id) => children(index, id).length === 0);
  const currentId = index.leafId && descendants.has(index.leafId) ? index.leafId : null;
  const targetIds = currentId && !endIds.includes(currentId) ? [currentId, ...endIds] : endIds;
  const choices = targetIds.map((targetId) => branchEndChoice(index, branchPointId, targetId, targetId === currentId));
  return choices.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return right.updatedAt - left.updatedAt || left.targetId.localeCompare(right.targetId);
  });
}

export function projectEditableTarget(entry: RpcSessionEntry): EditableTargetProjection | null {
  const content = editableContent(entry);
  if (content === undefined) return null;

  const text: string[] = [];
  const images: ImageAttachmentView[] = [];
  collectContent(content, entry.id, text, images);
  if (entry.type === "message" && isRecord(entry.message)) {
    collectAttachments(entry.message.attachments, entry.id, images);
  }
  return { entryId: entry.id, text: text.join("\n"), images };
}

function safeParentId(
  entry: RpcSessionEntry,
  entriesById: ReadonlyMap<string, RpcSessionEntry>,
): string | null {
  const parentId = entry.parentId;
  if (!parentId || !entriesById.has(parentId) || parentId === entry.id) return null;

  const seen = new Set([entry.id]);
  let currentId: string | null = parentId;
  while (currentId) {
    if (seen.has(currentId)) return null;
    seen.add(currentId);
    const current = entriesById.get(currentId);
    currentId = current?.parentId && entriesById.has(current.parentId) ? current.parentId : null;
  }
  return parentId;
}

function activeEntryPath(
  leafId: string | null,
  entriesById: ReadonlyMap<string, RpcSessionEntry>,
  parentById: ReadonlyMap<string, string | null>,
): string[] {
  if (!leafId || !entriesById.has(leafId)) return [];
  const path: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId && entriesById.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    path.push(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return path.reverse();
}

function branchEndChoice(
  index: SessionTreeIndex,
  branchPointId: string | null,
  targetId: string,
  isCurrent: boolean,
): BranchEndChoiceProjection {
  const path = pathBelow(index, branchPointId, targetId);
  const target = index.entriesById.get(targetId)!;
  const breadcrumbs = divergenceBreadcrumbs(index, branchPointId, path);
  const label = breadcrumbs.length ? breadcrumbs.join(" › ") : entryPreview(target, PREVIEW_LENGTH);
  const messageCount = path.filter((id) => isMessageLike(index.entriesById.get(id))).length;
  const updatedAt = entryTimestamp(target);
  const ending = endingDescription(target);
  const isEditable = editableContent(target) !== undefined;
  return {
    targetId,
    label: label || fallbackPreview(target),
    description: `${isCurrent ? "Current · " : ""}${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
    detail: `${ending}${isEditable ? " · Opens this prompt in Composer" : ""}`,
    isCurrent,
    isEditable,
    messageCount,
    updatedAt,
  };
}

function divergenceBreadcrumbs(
  index: SessionTreeIndex,
  branchPointId: string | null,
  path: readonly string[],
): string[] {
  const breadcrumbs: string[] = [];
  for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
    const parentId = pathIndex === 0 ? branchPointId : path[pathIndex - 1] ?? null;
    if (parentId !== branchPointId && children(index, parentId).length < 2) continue;
    const preview = firstMeaningfulPreview(index, path, pathIndex);
    if (preview && preview !== breadcrumbs.at(-1)) breadcrumbs.push(preview);
  }
  return breadcrumbs;
}

function firstMeaningfulPreview(index: SessionTreeIndex, path: readonly string[], start: number): string {
  for (let pathIndex = start; pathIndex < path.length; pathIndex++) {
    const entryId = path[pathIndex];
    const entry = entryId ? index.entriesById.get(entryId) : undefined;
    const preview = entry ? meaningfulText(entry) : "";
    if (preview) return truncate(preview, PREVIEW_LENGTH);
  }
  const entryId = path[start];
  const entry = entryId ? index.entriesById.get(entryId) : undefined;
  return entry ? fallbackPreview(entry) : "Unknown path";
}

function pathBelow(index: SessionTreeIndex, ancestorId: string | null, targetId: string): string[] {
  const path: string[] = [];
  let currentId: string | null = targetId;
  while (currentId && currentId !== ancestorId) {
    path.push(currentId);
    currentId = index.parentById.get(currentId) ?? null;
  }
  return currentId === ancestorId ? path.reverse() : [];
}

function descendantIds(index: SessionTreeIndex, parentId: string | null): string[] {
  const result: string[] = [];
  const pending = [...children(index, parentId)];
  const seen = new Set<string>();
  while (pending.length) {
    const entryId = pending.shift();
    if (!entryId || seen.has(entryId)) continue;
    seen.add(entryId);
    result.push(entryId);
    pending.push(...children(index, entryId));
  }
  return result;
}

function children(index: SessionTreeIndex, parentId: string | null): readonly string[] {
  return index.childrenById.get(parentId) ?? [];
}

function retainedChildren(index: SessionEntryIndex, parentId: string | null): readonly string[] {
  return index.childrenByParentId.get(parentId) ?? [];
}

function reachablePathCount(index: SessionEntryIndex, branchPointId: string | null): number {
  const descendants: string[] = [];
  const pending = [...retainedChildren(index, branchPointId)];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const entryId = pending.shift();
    if (!entryId || seen.has(entryId)) continue;
    seen.add(entryId);
    descendants.push(entryId);
    pending.push(...retainedChildren(index, entryId));
  }

  const terminalCount = descendants.filter((entryId) => retainedChildren(index, entryId).length === 0).length;
  const currentLeafIsNonTerminal = index.leafId !== null
    && seen.has(index.leafId)
    && retainedChildren(index, index.leafId).length > 0;
  return terminalCount + (currentLeafIsNonTerminal ? 1 : 0);
}

function endingDescription(entry: RpcSessionEntry): string {
  if (entry.type === "message" && isRecord(entry.message)) {
    const role = typeof entry.message.role === "string" ? entry.message.role : "message";
    return `Ends with ${role}: “${entryPreview(entry, DETAIL_LENGTH)}”`;
  }
  if (entry.type === "custom_message") return `Ends with custom message: “${entryPreview(entry, DETAIL_LENGTH)}”`;
  if (entry.type === "branch_summary") return `Ends with branch summary: “${entryPreview(entry, DETAIL_LENGTH)}”`;
  return `Ends with ${entry.type}: ${fallbackPreview(entry)}`;
}

function entryPreview(entry: RpcSessionEntry, maxLength: number): string {
  return truncate(meaningfulText(entry) || fallbackPreview(entry), maxLength);
}

function meaningfulText(entry: RpcSessionEntry): string {
  if (entry.type === "message" && isRecord(entry.message)) return contentText(entry.message.content);
  if (entry.type === "custom_message") return contentText(entry.content);
  if ((entry.type === "branch_summary" || entry.type === "compaction") && typeof entry.summary === "string") {
    return normalizeText(entry.summary);
  }
  return "";
}

function fallbackPreview(entry: RpcSessionEntry): string {
  const role = entry.type === "message" && isRecord(entry.message) && typeof entry.message.role === "string"
    ? entry.message.role
    : entry.type;
  return `${role} · ${entry.id.slice(0, 8)}`;
}

function editableContent(entry: RpcSessionEntry): unknown {
  if (entry.type === "message" && isRecord(entry.message) && entry.message.role === "user") return entry.message.content;
  if (entry.type === "custom_message") return entry.content;
  return undefined;
}

function collectContent(
  content: unknown,
  entryId: string,
  text: string[],
  images: ImageAttachmentView[],
): void {
  if (typeof content === "string") {
    text.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") text.push(part.text);
    if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      images.push(imageProjection(part, part.data, entryId, images.length));
    }
  }
}

function collectAttachments(
  attachments: unknown,
  entryId: string,
  images: ImageAttachmentView[],
): void {
  if (!Array.isArray(attachments)) return;
  for (const attachment of attachments) {
    if (!isRecord(attachment) || attachment.type !== "image" || typeof attachment.content !== "string" || typeof attachment.mimeType !== "string") continue;
    images.push(imageProjection(attachment, attachment.content, entryId, images.length));
  }
}

function imageProjection(
  image: Record<string, unknown>,
  data: string,
  entryId: string,
  index: number,
): ImageAttachmentView {
  const mimeType = image.mimeType as string;
  return {
    id: typeof image.id === "string" ? image.id : `${entryId}-image-${index + 1}`,
    name: typeof image.fileName === "string" ? image.fileName : "image",
    mimeType,
    dataUrl: `data:${mimeType};base64,${data}`,
    size: typeof image.size === "number" ? image.size : Buffer.byteLength(data, "base64"),
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return normalizeText(content);
  if (!Array.isArray(content)) return "";
  return normalizeText(content
    .map((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join(" "));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function entryTimestamp(entry: RpcSessionEntry): number {
  if (typeof entry.timestamp === "string") {
    const parsed = Date.parse(entry.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)) return entry.timestamp;
  if (entry.type === "message" && isRecord(entry.message) && typeof entry.message.timestamp === "number") {
    return entry.message.timestamp;
  }
  return 0;
}

function isMessageLike(entry: RpcSessionEntry | undefined): boolean {
  return entry?.type === "message" || entry?.type === "custom_message";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
