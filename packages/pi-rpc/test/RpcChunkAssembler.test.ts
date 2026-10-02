import { describe, expect, it } from "vitest";

import {
  RPC_MAX_FRAME_BYTES,
  RpcChunkAssembler,
} from "../src/protocol/RpcChunkAssembler.js";

const CHUNK_BYTES = 256 * 1024;

function chunkFrames(value: unknown, chunkId = "rpc-test") {
  const bytes = Buffer.from(JSON.stringify(value));
  const count = Math.ceil(bytes.byteLength / CHUNK_BYTES);
  return Array.from({ length: count }, (_, index) => ({
    type: "rpc_chunk",
    chunkId,
    index,
    count,
    byteLength: bytes.byteLength,
    data: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString("base64"),
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
    const frames = chunkFrames(logical);
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(assembler.push(frames.at(-1))).toEqual(logical);
  });

  it("rejects an interrupted chunk sequence", () => {
    const assembler = new RpcChunkAssembler();
    const [first] = chunkFrames({ type: "response", data: "x".repeat(RPC_MAX_FRAME_BYTES) });
    expect(assembler.push(first)).toBeUndefined();
    expect(() => assembler.push({ type: "agent_start" })).toThrow(/interrupted/);
  });

  it("rejects a reassembled JSON value that is not an object frame", () => {
    const assembler = new RpcChunkAssembler();
    const frames = chunkFrames("x".repeat(RPC_MAX_FRAME_BYTES), "rpc-scalar");
    for (const frame of frames.slice(0, -1)) expect(assembler.push(frame)).toBeUndefined();
    expect(() => assembler.push(frames.at(-1))).toThrow(/object frame/);
  });
});
