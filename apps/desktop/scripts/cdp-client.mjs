import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** The packaged app exposes Chromium's standard DevTools endpoint only when asked with a test switch. */
export const debuggingSwitch = "--remote-debugging-port=0";

const connectionTimeout = 10_000;
const requestTimeout = 30_000;
const pollTimeout = 2_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function findFile(root, name, depth) {
  if (depth < 0) return undefined;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = findFile(path, name, depth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

async function debuggingPort(searchRoots, deadline) {
  while (Date.now() < deadline) {
    for (const root of searchRoots) {
      const file = findFile(root, "DevToolsActivePort", 2);
      if (!file) continue;
      let port;
      try {
        [port] = readFileSync(file, "utf8").split(/\r?\n/);
      } catch {
        // Chromium can hold the endpoint file briefly while publishing its port.
      }
      if (port) return Number(port);
    }
    await delay(100);
  }
  throw new Error("The packaged app did not open its DevTools endpoint.");
}

async function applicationPage(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(pollTimeout) });
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && String(target.url).includes("/renderer/"));
      if (page) return page;
    } catch {
      // The endpoint can accept connections before the window finishes loading.
    }
    await delay(100);
  }
  throw new Error("The packaged app opened no renderer page.");
}

/** A previous run leaves its endpoint file behind; each launch must publish its own port. */
export function clearDebuggingEndpoint(searchRoots) {
  for (const root of searchRoots) {
    const file = findFile(root, "DevToolsActivePort", 2);
    if (file) rmSync(file, { force: true });
  }
}

async function openDebuggingSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("The packaged renderer did not accept the DevTools connection in time."));
    }, connectionTimeout);
    const settle = (action) => (event) => {
      clearTimeout(timer);
      action(event);
    };
    socket.addEventListener("open", settle(resolve), { once: true });
    socket.addEventListener("error", settle(() => reject(new Error("The packaged renderer refused the DevTools connection."))), { once: true });
  });
  return socket;
}

/**
 * Connects to the real packaged window through the standard DevTools protocol.
 * Nothing in the product is added for testing; the process is started with an
 * ordinary Chromium debugging switch on an ephemeral, loopback-only port.
 */
export async function connectToApplication({ searchRoots, deadline }) {
  const port = await debuggingPort(searchRoots, deadline);
  const page = await applicationPage(port, deadline);
  return devtoolsClient(await openDebuggingSocket(page.webSocketDebuggerUrl));
}

function devtoolsClient(socket) {
  let sequence = 0;
  const pending = new Map();
  const failPending = (message) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  socket.addEventListener("message", async (event) => {
    const text = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => failPending("The packaged window closed during verification."));
  socket.addEventListener("error", () => failPending("The DevTools connection failed during verification."));

  const send = (method, params = {}) => {
    const id = ++sequence;
    // Every request is bounded: an unanswered call must not outlive the verification deadline.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`DevTools ${method} did not answer in time.`));
      }, requestTimeout);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${description}`);
    }
    return result.result.value;
  };
  return {
    evaluate,
    insertText: (text) => send("Input.insertText", { text }),
    /** Types into the shared composer as a user would, instead of calling host internals. */
    typeIntoComposer: async (text) => {
      await evaluate("document.querySelector('.cm-content[aria-label=\"Message Pi\"]')?.focus()");
      await send("Input.insertText", { text });
    },
    close: () => socket.close(),
  };
}
