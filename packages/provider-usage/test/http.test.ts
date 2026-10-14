import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { fetch as undiciFetch } from "undici";
import { expect, test } from "vitest";
import { createUsageDispatcher, createUsageHttpTransport, type UsageFetch } from "../src/http.js";

const endpoint = "https://api.deepseek.com/user/balance";
const signal = () => new AbortController().signal;
const headers = { Authorization: "Bearer synthetic-http-secret-only" };

test("HTTP rejects redirects, oversized bodies, bad JSON and content-bearing errors safely", async () => {
  const replies = [
    () => new Response(null, { status: 302, headers: { Location: "https://unrelated.example.test" } }),
    () => new Response("x".repeat(64 * 1024 + 1)),
    () => new Response(`invalid ${headers.Authorization}`),
    () => new Response(headers.Authorization, { status: 401 }),
    () => Response.json([]),
  ];
  for (const reply of replies) {
    const transport = createUsageHttpTransport("deepseek", {}, () => Promise.resolve(reply()));
    try {
      const error = await transport.json(endpoint, headers, signal()).catch((value: unknown) => value);
      expect(error instanceof Error).toBe(true);
      expect(String(error).includes(headers.Authorization)).toBe(false);
    } finally { await transport.close(); }
  }
});

test("an unapproved origin is rejected before credentials reach the transport", async () => {
  let called = false;
  const transport = createUsageHttpTransport("deepseek", {}, () => { called = true; return Promise.resolve(Response.json({})); });
  try {
    await transport.json("https://unrelated.example.test", headers, signal()).catch(() => undefined);
    expect(called).toBe(false);
  } finally { await transport.close(); }
});

test("a stalled response body is cancelled when its caller aborts", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start() { started(); }, cancel() { cancelled = true; } });
  const fetch: UsageFetch = () => Promise.resolve(({ ok: true, status: 200, redirected: false, body }));
  const transport = createUsageHttpTransport("deepseek", {}, fetch);
  try {
    const pending = transport.json(endpoint, headers, controller.signal).catch((error: unknown) => error instanceof Error && error.name === "AbortError");
    await start; await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort();
    expect(await pending).toBe(true);
    expect(cancelled).toBe(true);
  } finally { await transport.close(); }
});

test("unsupported proxy schemes fail rather than silently sending a direct request", () => {
  for (const environment of [{ HTTPS_PROXY: "socks5://127.0.0.1:9999" }, { ALL_PROXY: "socks5://127.0.0.1:9999" }]) {
    let failed = false;
    try { createUsageDispatcher(environment); } catch { failed = true; }
    expect(failed).toBe(true);
  }
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test server did not bind.");
  return address.port;
}

test("explicit proxy environment and NO_PROXY are honored by the real HTTP client", async () => {
  const sockets = new Set<Socket>();
  const target = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end('{"local":true}'); });
  const proxy = createServer();
  for (const server of [target, proxy]) server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  const targetPort = await listen(target);
  const proxyPort = await listen(proxy);
  let tunnels = 0;
  let blockedHttpsTunnel = false;
  proxy.on("connect", (request, client, head) => {
    // The test proxy may connect only to its own fixture, never any provider.
    if (request.url !== `127.0.0.1:${targetPort}`) {
      blockedHttpsTunnel = request.url === "api.deepseek.com:443";
      client.destroy();
      return;
    }
    tunnels++;
    const upstream = connect(targetPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    client.on("error", () => upstream.destroy()); upstream.on("error", () => client.destroy());
  });
  try {
    for (const bypass of [false, true]) {
      const dispatcher = createUsageDispatcher({ HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: bypass ? "127.0.0.1" : "" });
      try {
        const response = await undiciFetch(`http://127.0.0.1:${targetPort}/usage`, { dispatcher });
        expect(response.ok).toBe(true);
        expect((await response.json() as { local: boolean }).local).toBe(true);
      } finally { await dispatcher.destroy(); }
    }
    expect(tunnels).toBe(1);
    // HTTPS must also go through the fixture proxy. It deliberately refuses
    // this CONNECT target; no connection to a real provider is made.
    const transport = createUsageHttpTransport("deepseek", { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` });
    try {
      await transport.json(endpoint, headers, AbortSignal.timeout(300)).catch(() => undefined);
      expect(blockedHttpsTunnel).toBe(true);
    } finally { await transport.close(); }
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([target, proxy].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
});
