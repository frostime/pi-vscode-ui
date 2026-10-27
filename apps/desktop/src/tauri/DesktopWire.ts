import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import { DESKTOP_MESSAGE_LIMIT_BYTES } from "../shared/desktopTransport.js";

export const MAX_FRAME_BYTES = DESKTOP_MESSAGE_LIMIT_BYTES;
/** Bounded NDJSON framing. stdout is private transport; diagnostics must never include frame content. */
export class DesktopWire extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private writes = Promise.resolve();
  private queued = 0;
  private closed = false;
  constructor(input: Readable, private readonly output: Writable, private readonly maximumFrame = MAX_FRAME_BYTES) {
    super();
    input.on("data", (chunk: Buffer) => {
      if (this.closed) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      let newline: number;
      while ((newline = this.buffer.indexOf(10)) >= 0) {
        if (newline > this.maximumFrame) { this.fail(); return; }
        const line = this.buffer.subarray(0, newline); this.buffer = this.buffer.subarray(newline + 1);
        try { const value: unknown = JSON.parse(line.toString("utf8")); this.emit("packet", value); }
        catch { this.fail(); return; }
      }
      if (this.buffer.length > this.maximumFrame) this.fail();
    });
    input.on("end", () => { this.closed = true; this.emit("disconnect"); });
    input.on("error", () => this.fail());
    output.on("error", () => this.fail());
  }
  private fail(): void { if (!this.closed) { this.closed = true; this.emit("disconnect"); } }
  /** A locally generated oversized message is rejected without corrupting the connection. */
  send(value: unknown): boolean {
    if (this.closed) return false;
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > this.maximumFrame) return false;
    const frame = Buffer.from(json + "\n");
    if (this.queued + frame.length > this.maximumFrame * 2) { this.fail(); return false; }
    this.queued += frame.length;
    this.writes = this.writes.then(() => new Promise<void>((resolve, reject) => {
      this.output.write(frame, (error) => { this.queued -= frame.length; if (error) reject(error); else resolve(); });
    })).catch(() => this.fail());
    return true;
  }
  flush(): Promise<void> { return this.writes; }
}
