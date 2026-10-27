const connectionTimeout = 10_000;
const requestTimeout = 30_000;

export async function openDebuggingSocket(url) {
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

export function devtoolsClient(socket) {
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
    command: send,
    insertText: (text) => send("Input.insertText", { text }),
    /** Types into the shared composer as a user would, instead of calling host internals. */
    typeIntoComposer: async (text) => {
      await evaluate("document.querySelector('.cm-content[aria-label=\"Message Pi\"]')?.focus()");
      await send("Input.insertText", { text });
    },
    close: () => socket.close(),
  };
}
