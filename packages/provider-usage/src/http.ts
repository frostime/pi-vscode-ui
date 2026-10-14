import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

import { providerDefinition } from "./providerDefinitions.js";

/** Trusted injection point for deterministic tests or another HTTP transport. */
export type UsageFetch = (
  url: string,
  request: { method: "GET"; headers: Record<string, string>; redirect: "error"; signal: AbortSignal },
) => Promise<Pick<Response, "ok" | "status" | "redirected" | "body">>;

export interface UsageHttpTransport {
  json(url: string, headers: Record<string, string>, signal: AbortSignal, options?: UsageRequestOptions): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface UsageRequestOptions {
  userAgent?: boolean;
  responseError?: (status: number, text: string) => string | undefined;
}

/** Only locally generated, content-free transport errors reach public failures. */
export class UsageRequestError extends Error {}

const MAX_SUCCESS_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 4 * 1024;

export function abortError(): Error {
  return Object.assign(new Error("Usage query cancelled."), { name: "AbortError" });
}

/** Explicit environment only; empty options prevent undici's process-env fallback. */
export function createUsageDispatcher(environment: Readonly<Record<string, string | undefined>>): EnvHttpProxyAgent {
  const httpProxy = environment.http_proxy || environment.HTTP_PROXY || "";
  const httpsProxy = environment.https_proxy || environment.HTTPS_PROXY || httpProxy;
  const noProxy = environment.no_proxy || environment.NO_PROXY || "";
  const allProxy = environment.all_proxy || environment.ALL_PROXY;
  if (allProxy && !httpProxy && !httpsProxy) {
    throw new UsageRequestError("The configured all-protocol proxy is unsupported; usage was not requested directly.");
  }
  for (const proxy of [httpProxy, httpsProxy]) {
    if (!proxy) continue;
    try {
      const url = new URL(proxy);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new UsageRequestError("The configured HTTP proxy is invalid or unsupported.");
    }
  }
  return new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy });
}

/** No global dispatcher/environment mutation. One query owns and releases its agent. */
export function createUsageHttpTransport(
  providerId: string,
  environment: Readonly<Record<string, string | undefined>>,
  fetchOverride?: UsageFetch,
): UsageHttpTransport {
  const dispatcher = createUsageDispatcher(environment);
  const send: UsageFetch = fetchOverride ?? ((url, options) => undiciFetch(url, { ...options, dispatcher }));
  return {
    async json(url, headers, signal, options = {}) {
      assertOfficialUsageOrigin(providerId, url);
      if (signal.aborted) throw abortError();
      let response: Awaited<ReturnType<UsageFetch>>;
      try {
        response = await send(url, {
          method: "GET",
          headers: { ...(options.userAgent === false ? {} : { "User-Agent": "pi-provider-usage" }), ...headers },
          redirect: "error",
          signal,
        });
      } catch {
        if (signal.aborted) throw abortError();
        throw new UsageRequestError("Provider usage request failed. Check connectivity and provider authentication.");
      }
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new UsageRequestError("Provider usage redirects are not allowed.");
      }
      const text = await readBoundedResponse(response.body, response.ok ? MAX_SUCCESS_BYTES : MAX_ERROR_BYTES, signal);
      const providerError = options.responseError?.(response.status, text);
      if (providerError) throw new UsageRequestError(providerError);
      if (!response.ok) throw new UsageRequestError(`Provider usage request returned HTTP ${response.status}.`);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UsageRequestError("Provider usage response was not valid JSON.");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new UsageRequestError("Provider usage response was not an object.");
      }
      return payload as Record<string, unknown>;
    },
    async close() {
      // destroy releases sockets promptly, including a cancelled in-flight request.
      await dispatcher.destroy();
    },
  };
}

function assertOfficialUsageOrigin(providerId: string, value: string): void {
  const definition = providerDefinition(providerId);
  try {
    const url = new URL(value);
    if (!definition || url.protocol !== "https:" || url.username || url.password || url.origin !== new URL(definition.usageEndpoint).origin) {
      throw new Error();
    }
  } catch {
    throw new UsageRequestError("Usage request destination is not an approved provider origin.");
  }
}

/** Bounds both successful payloads and error bodies without ever returning error text. */
async function readBoundedResponse(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw abortError();
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UsageRequestError("Provider usage response exceeded the size limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (error instanceof UsageRequestError) throw error;
    throw new UsageRequestError("Provider usage response could not be read.");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(buffer);
}
