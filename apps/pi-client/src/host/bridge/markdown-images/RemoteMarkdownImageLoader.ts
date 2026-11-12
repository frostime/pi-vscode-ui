import type { ReadableStream } from "node:stream/web";

import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

import type { MarkdownImageLoadResult } from "../../../shared/bridge/hostToWebview.js";
import { classifyMarkdownImageBytes } from "./MarkdownImageResolver.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const REQUEST_HEADERS = {
  Accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml;q=0.9,*/*;q=0.1",
  "User-Agent": "FrostPi",
};

export interface RemoteImageResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

/** Trusted injection point for deterministic tests or another HTTP transport. */
export type RemoteImageFetch = (
  url: string,
  request: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    referrerPolicy: "no-referrer";
    signal: AbortSignal;
  },
) => Promise<RemoteImageResponse>;

export interface RemoteMarkdownImageOptions {
  maxBytes: number;
  /** Proxy policy as an explicit environment copy; the process environment is not consulted. */
  environment: Readonly<Record<string, string | undefined>>;
  fetch?: RemoteImageFetch;
  timeoutMs?: number;
}

/**
 * Fetches one remote Markdown image in the Host after the user asked for it.
 *
 * The Webview's Content Security Policy grants no remote origin, so rendered content
 * (Mermaid, KaTeX, CSS) cannot open a network channel by itself; this consented
 * request is the only route to a remote image. It carries no cookies, credentials or
 * referrer, follows only HTTPS redirects, and returns bounded bytes that are
 * identified by content exactly like a local image. URLs and bytes are never logged.
 */
export async function loadRemoteMarkdownImage(
  source: string,
  options: RemoteMarkdownImageOptions,
): Promise<MarkdownImageLoadResult> {
  let url = remoteImageUrl(source);
  if (!url) return { ok: false, reason: "invalidSource" };

  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let dispatcher: EnvHttpProxyAgent | undefined;
  try {
    let send = options.fetch;
    if (!send) {
      const agent = createProxyDispatcher(options.environment);
      dispatcher = agent;
      send = (target, request) => undiciFetch(target, { ...request, dispatcher: agent });
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await send(url.href, {
        method: "GET",
        headers: REQUEST_HEADERS,
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        await discard(response);
        const next = redirectTarget(url, response.headers.get("location"));
        if (!next) return { ok: false, reason: "readFailed" };
        url = next;
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        await discard(response);
        return { ok: false, reason: "notFound" };
      }
      if (response.status < 200 || response.status >= 300) {
        await discard(response);
        return { ok: false, reason: "readFailed" };
      }

      const declaredLength = Number(response.headers.get("content-length") ?? Number.NaN);
      if (declaredLength > options.maxBytes) {
        await discard(response);
        return { ok: false, reason: "tooLarge" };
      }
      const data = await readBounded(response.body, options.maxBytes);
      return data ? classifyMarkdownImageBytes(data) : { ok: false, reason: "tooLarge" };
    }
    return { ok: false, reason: "readFailed" };
  } catch {
    // Network, proxy, TLS and timeout failures share one content-free result.
    return { ok: false, reason: "readFailed" };
  } finally {
    // destroy releases sockets promptly, including a timed-out in-flight request.
    await dispatcher?.destroy().catch(() => undefined);
  }
}

/** Accepts only credential-free HTTPS URLs; every redirect hop is held to the same rule. */
function remoteImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function redirectTarget(from: URL, location: string | null): URL | null {
  if (!location) return null;
  try {
    return remoteImageUrl(new URL(location, from).href);
  } catch {
    return null;
  }
}

/**
 * Same policy as Provider Usage requests: explicit environment only (empty options
 * prevent undici's process-env fallback), and a proxy this client cannot use fails
 * the request instead of silently bypassing it with a direct connection.
 */
function createProxyDispatcher(environment: Readonly<Record<string, string | undefined>>): EnvHttpProxyAgent {
  const httpProxy = environment.http_proxy || environment.HTTP_PROXY || "";
  const httpsProxy = environment.https_proxy || environment.HTTPS_PROXY || httpProxy;
  const noProxy = environment.no_proxy || environment.NO_PROXY || "";
  const allProxy = environment.all_proxy || environment.ALL_PROXY;
  if (allProxy && !httpProxy && !httpsProxy) {
    throw new Error("The configured all-protocol proxy is unsupported.");
  }
  for (const proxy of [httpProxy, httpsProxy]) {
    if (!proxy) continue;
    if (!["http:", "https:"].includes(new URL(proxy).protocol)) {
      throw new Error("The configured HTTP proxy is unsupported.");
    }
  }
  return new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy });
}

async function discard(response: RemoteImageResponse): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Returns null as soon as the body exceeds the limit, without buffering the remainder. */
async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
