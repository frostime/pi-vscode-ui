import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { DesktopWire } from "../src/tauri/DesktopWire.js";
import { isDesktopRequest } from "../src/shared/desktopTransport.js";

describe("Desktop private stdio transport", () => {
  it("preserves UTF-8 across fragmented frames and multiple packets in a chunk", () => {
    const input = new PassThrough(); const wire = new DesktopWire(input, new PassThrough());
    const received: unknown[] = []; wire.on("packet", (packet: unknown) => received.push(packet));
    const bytes = Buffer.from(JSON.stringify({ text: "中文 😀" }) + '\n{"sequence":2}\n');
    for (let i = 0; i < bytes.length; i += 2) input.write(bytes.subarray(i, i + 2));
    expect(received).toEqual([{ text: "中文 😀" }, { sequence: 2 }]);
  });
  it("bounds malformed or oversized input and does not dispatch a partial frame", () => {
    for (const data of ['{"incomplete":', '{bad}\n']) {
      const input = new PassThrough(); const wire = new DesktopWire(input, new PassThrough(), 8);
      let disconnected = 0; let packets = 0;
      wire.on("disconnect", () => disconnected++); wire.on("packet", () => packets++);
      input.write(data);
      expect(disconnected).toBe(1); expect(packets).toBe(0);
    }
  });
  it("keeps output ordered when the parent reads slowly and flush drains queued writes", async () => {
    const frames: string[] = [];
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) { setTimeout(() => { frames.push(chunk.toString()); callback(); }, 5); } });
    const wire = new DesktopWire(new PassThrough(), output);
    for (let i = 0; i < 20; i++) wire.send({ sequence: i });
    await wire.flush();
    expect(frames.map((line) => (JSON.parse(line) as { sequence: number }).sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
  it("accepts a large image-sized payload without treating stream chunks as messages", async () => {
    const input = new PassThrough(); const output = new PassThrough(); const wire = new DesktopWire(input, output);
    const payload = "a".repeat(5 * 1024 * 1024); const received: unknown[] = [];
    wire.on("packet", (packet: unknown) => received.push(packet));
    const bytes = Buffer.from(JSON.stringify({ data: payload }) + "\n");
    for (let i = 0; i < bytes.length; i += 65536) input.write(bytes.subarray(i, i + 65536));
    expect(received).toEqual([{ data: payload }]);
    await wire.flush();
  });
  it("rejects oversized output without disconnecting and measures UTF-8 JSON without the newline", async () => {
    const value = { text: "中文 😀" };
    const maximum = Buffer.byteLength(JSON.stringify(value));
    const output = new PassThrough(); const frames: string[] = [];
    output.on("data", (chunk: Buffer) => frames.push(chunk.toString()));
    const wire = new DesktopWire(new PassThrough(), output, maximum);
    let disconnected = false; wire.on("disconnect", () => disconnected = true);
    expect(wire.send(value)).toBe(true);
    await wire.flush();
    expect(wire.send({ text: "中文 😀x" })).toBe(false);
    expect(disconnected).toBe(false);
    expect(wire.send({ ok: true })).toBe(true);
    await wire.flush();
    expect(frames.map((line) => JSON.parse(line) as unknown)).toEqual([value, { ok: true }]);
  });
  it("does not expose native operations or arbitrary channels through renderer requests", () => {
    expect(isDesktopRequest({ channel: "frostpi:settings:action", args: [{ type: "read" }] })).toBe(true);
    for (const channel of ["openPath", "native", "frostpi:arbitrary", "__proto__"]) expect(isDesktopRequest({ channel, args: [] })).toBe(false);
    expect(isDesktopRequest({ channel: "frostpi:client:in", args: "not an array" })).toBe(false);
  });
});
