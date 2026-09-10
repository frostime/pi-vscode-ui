import type { MarkdownImageLoadResult } from "$shared/bridge/hostToWebview";
import { get } from "svelte/store";

import { postToHost } from "../../../bridge/vscodeBridge";
import { presentationStore } from "../../../state/sessionViewStore.svelte";
import { createId } from "../../../utils/createId";

interface PendingRequest {
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve(result: MarkdownImageLoadResult): void;
}

interface CachedResult {
  result: Extract<MarkdownImageLoadResult, { ok: true }>;
  expiresAt: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_CHARACTERS = 24 * 1024 * 1024;

const pending = new Map<string, PendingRequest>();
const inFlight = new Map<string, Promise<MarkdownImageLoadResult>>();
const cache = new Map<string, CachedResult>();

export function loadLocalMarkdownImage(source: string): Promise<MarkdownImageLoadResult> {
  const sessionId = get(presentationStore).displayedSession?.id;
  if (!sessionId) return Promise.resolve({ ok: false, reason: "invalidSource" });

  const key = `${sessionId}\0${source}`;
  const cached = cachedResult(key);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const requestId = createId("markdown-image");
  const request = new Promise<MarkdownImageLoadResult>((resolve) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      resolve({ ok: false, reason: "readFailed" });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { sessionId, timeout, resolve });
    postToHost({ type: "loadMarkdownImage", requestId, sessionId, source });
  }).then((result) => {
    if (result.ok) cacheResult(key, result);
    return result;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function deliverMarkdownImageResult(
  requestId: string,
  sessionId: string,
  result: MarkdownImageLoadResult,
): void {
  const request = pending.get(requestId);
  if (!request || request.sessionId !== sessionId) return;
  pending.delete(requestId);
  clearTimeout(request.timeout);
  request.resolve(result);
}

function cachedResult(key: string): Extract<MarkdownImageLoadResult, { ok: true }> | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.result;
}

function cacheResult(key: string, result: Extract<MarkdownImageLoadResult, { ok: true }>): void {
  cache.delete(key);
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > MAX_CACHE_ENTRIES || cachedCharacters() > MAX_CACHE_CHARACTERS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function cachedCharacters(): number {
  let size = 0;
  for (const cached of cache.values()) size += cached.result.data.length;
  return size;
}
