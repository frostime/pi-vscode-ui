import { describe, expect, it } from "vitest";

import {
  RPC_MAX_FRAME_BYTES,
  RPC_MAX_REASSEMBLED_BYTES,
  RpcChunkAssembler,
} from "../src/protocol/RpcChunkAssembler.js";

const CHUNK_BYTES = 256 * 1024;

function chunkFrames(value: unknown, chunkBytes = CHUNK_BYTES, chunkId = "rpc-test") {
  const bytes = Buffer.from(JSON.stringify(value));
  const count = Math.ceil(bytes.byteLength / chunkBytes);
  return Array.from({ length: count }, (_, index) => ({
    type: "rpc_chunk",
    chunkId,
    index,
    count,
    byteLength: bytes.byteLength,
    data: bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64"),
  }));
}

describe("RpcChunkAssembler", () => {
  it("passes ordinary frames through unchanged", () => {
    const assembler = new RpcChunkAssembler();
    const frame = { type: "agent_start" };
    expect(assembler.push(frame)).toBe(frame);
  });

  it("reassembles an ordered multi-chunk object frame", () => {
    const assembler = new RpcChunkAssembler();
    const logical = {
      type: "response",
      id: "req_1",
      success: true,
      data: { text: "x".repeat(RPC_MAX_FRAME_BYTES) },
    };
    const frames = chunkFrames(logical, 128 * 1024);
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(assembler.push(frames.at(-1))).toEqual(logical);
  });

  it("accepts a smaller advertised frame limit with smaller multi-chunk payloads", () => {
    const limits = { maxFrameBytes: 512 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 };
    const assembler = new RpcChunkAssembler(limits);
    const logical = { type: "response", success: true, data: { text: "x".repeat(600 * 1024) } };
    const frames = chunkFrames(logical, 128 * 1024);
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame, Buffer.byteLength(JSON.stringify(frame), "utf8") + 1)).toBeUndefined();
    expect(assembler.push(frames.at(-1), Buffer.byteLength(JSON.stringify(frames.at(-1)), "utf8") + 1)).toEqual(logical);
  });

  it.each([200 * 1024, 600 * 1024])("accepts chunked logical frames below the baseline line limit (%i bytes)", (textBytes) => {
    const assembler = new RpcChunkAssembler();
    const logical = { type: "response", success: true, data: { text: "x".repeat(textBytes) } };
    const frames = chunkFrames(logical, 128 * 1024);
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(assembler.push(frames.at(-1))).toEqual(logical);
  });

  it.each([
    { metadata: { byteLength: 0 }, error: "Invalid RPC chunk metadata" },
    { metadata: { count: 0 }, error: "Invalid RPC chunk metadata" },
    { metadata: { byteLength: RPC_MAX_REASSEMBLED_BYTES + 1 }, error: "RPC chunk logical frame exceeds the advertised reassembly limit" },
    { metadata: { count: 257, byteLength: 256 }, error: "Invalid RPC chunk metadata" },
  ])("rejects invalid metadata or advertised-limit violations ($metadata)", ({ metadata, error }) => {
    const [frame] = chunkFrames({ type: "response", data: "x".repeat(600 * 1024) });
    const assembler = new RpcChunkAssembler({ maxFrameBytes: RPC_MAX_FRAME_BYTES, maxReassembledFrameBytes: RPC_MAX_REASSEMBLED_BYTES });
    expect(() => assembler.push({ ...frame, ...metadata })).toThrow(error);
  });

  it("rejects a chunk frame above the advertised physical frame limit", () => {
    const [frame] = chunkFrames({ type: "response", data: "x".repeat(600 * 1024) }, 400 * 1024);
    const assembler = new RpcChunkAssembler({ maxFrameBytes: 512 * 1024, maxReassembledFrameBytes: RPC_MAX_REASSEMBLED_BYTES });
    expect(() => assembler.push(frame)).toThrow("RPC chunk exceeds the advertised physical frame limit");
  });

  it("reassembles more than 256 chunks when a peer splits data more finely", () => {
    const assembler = new RpcChunkAssembler({ maxFrameBytes: 1024, maxReassembledFrameBytes: RPC_MAX_REASSEMBLED_BYTES });
    const logical = { type: "response", data: { text: "x".repeat(20 * 1024) } };
    const frames = chunkFrames(logical, 64);
    expect(frames.length).toBeGreaterThan(256);
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(assembler.push(frames.at(-1))).toEqual(logical);
  });

  it("reassembles histories above the baseline 64 MiB when the peer advertises a higher limit", () => {
    const assembler = new RpcChunkAssembler({ maxFrameBytes: 2 * 1024 * 1024, maxReassembledFrameBytes: 128 * 1024 * 1024 });
    const textBytes = RPC_MAX_REASSEMBLED_BYTES + 1;
    const bytes = Buffer.from(JSON.stringify({ type: "response", data: { text: "x".repeat(textBytes) } }));
    const chunkBytes = 512 * 1024;
    const count = Math.ceil(bytes.byteLength / chunkBytes);
    let result: unknown;
    for (let index = 0; index < count; index += 1) {
      result = assembler.push({
        type: "rpc_chunk",
        chunkId: "large-history",
        index,
        count,
        byteLength: bytes.byteLength,
        data: bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64"),
      });
    }
    expect(result).toMatchObject({ type: "response" });
    expect((result as { data: { text: string } }).data.text).toHaveLength(textBytes);
  }, 15_000);

  it("rejects an interrupted chunk sequence", () => {
    const assembler = new RpcChunkAssembler();
    const [first] = chunkFrames({ type: "response", data: "x".repeat(RPC_MAX_FRAME_BYTES) });
    expect(assembler.push(first)).toBeUndefined();
    expect(() => assembler.push({ type: "agent_start" })).toThrow(/interrupted/);
  });

  it("rejects a reassembled JSON value that is not an object frame", () => {
    const assembler = new RpcChunkAssembler();
    const frames = chunkFrames("x".repeat(RPC_MAX_FRAME_BYTES), 128 * 1024, "rpc-scalar");
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(() => assembler.push(frames.at(-1))).toThrow(/object frame/);
  });
});
