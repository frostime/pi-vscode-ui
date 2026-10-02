/** Baseline OMP v2 physical-frame ceiling; a ready declaration overrides it per connection. */
export const RPC_MAX_FRAME_BYTES = 1024 * 1024;
/** Baseline OMP v2 logical-frame ceiling; not a fixed FrostPi resource budget. */
export const RPC_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;

export interface RpcChunkLimits {
  readonly maxFrameBytes: number;
  readonly maxReassembledFrameBytes: number;
}
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isRpcChunkFrame(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "type" in value && value.type === "rpc_chunk";
}

type ChunkMetadata = { chunkId: string; index: number; count: number; byteLength: number };

type PendingChunks = {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Buffer[];
  receivedBytes: number;
};

/** Reassemble logical RPC frames before response correlation and event dispatch. */
export class RpcChunkAssembler {
  #pending: PendingChunks | null = null;
  readonly #limits: RpcChunkLimits;

  constructor(limits: RpcChunkLimits = {
    maxFrameBytes: RPC_MAX_FRAME_BYTES,
    maxReassembledFrameBytes: RPC_MAX_REASSEMBLED_BYTES,
  }) {
    this.#limits = { ...limits };
  }

  reset(): void {
    this.#pending = null;
  }

  /**
   * Feed one parsed JSONL value. Returns the complete frame, or `undefined` while a chunk sequence
   * is still incomplete. Non-chunk values pass through untouched.
   */
  push(value: unknown, frameBytes?: number): unknown {
    if (!isRpcChunkFrame(value)) {
      if (this.#pending) throw new Error("RPC chunk sequence interrupted");
      return value;
    }

    const { chunkId, index, count, byteLength } = readChunkMetadata(value);
    // The runtime's ready limits govern this stream, not the current OMP encoder's 256 KiB
    // chunk size or 256-chunk count. A smaller line ceiling can require sub-1-MiB logical frames
    // or more chunks; a larger ceiling can permit larger chunks and histories. Validate the
    // actual physical frame and declared total instead of imposing those baseline assumptions.
    const physicalBytes = frameBytes ?? Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
    if (physicalBytes > this.#limits.maxFrameBytes) throw new Error("RPC chunk exceeds the advertised physical frame limit");
    if (byteLength > this.#limits.maxReassembledFrameBytes) {
      throw new Error("RPC chunk logical frame exceeds the advertised reassembly limit");
    }
    const payload = decodeChunkPayload(value.data);

    let pending = this.#pending;
    if (!pending) {
      if (index !== 0) throw new Error("RPC chunk sequence must start at index 0");
      pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
      this.#pending = pending;
    }
    if (
      pending.chunkId !== chunkId ||
      pending.count !== count ||
      pending.byteLength !== byteLength ||
      pending.nextIndex !== index
    ) {
      throw new Error("RPC chunk sequence mismatch");
    }

    pending.chunks.push(payload);
    pending.receivedBytes += payload.byteLength;
    pending.nextIndex += 1;
    if (pending.receivedBytes > pending.byteLength) throw new Error("RPC chunk sequence exceeds its declared length");
    if (pending.nextIndex < pending.count) return undefined;
    if (pending.receivedBytes !== pending.byteLength) throw new Error("RPC chunk sequence length mismatch");

    this.#pending = null;
    const frame: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks)));
    if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
      throw new Error("RPC chunk payload must reassemble to an object frame");
    }
    return frame;
  }
}

/** `Number.isSafeInteger` is a boolean check, so it cannot narrow the unparsed RPC payload by itself. */
function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function readChunkMetadata(value: Record<string, unknown>): ChunkMetadata {
  const { chunkId, index, count, byteLength } = value;
  if (typeof chunkId !== "string" || chunkId.length === 0 || chunkId.length > 128) {
    throw new Error("Invalid RPC chunk metadata");
  }
  if (!isSafeInteger(index) || !isSafeInteger(count) || !isSafeInteger(byteLength)) {
    throw new Error("Invalid RPC chunk metadata");
  }
  // OMP v2 requires multiple non-empty chunks. Each chunk contributes at least one decoded
  // byte, so count <= byteLength is an integrity invariant, not a fixed chunk-count budget.
  if (index < 0 || count < 2 || index >= count || byteLength < 1 || count > byteLength) {
    throw new Error("Invalid RPC chunk metadata");
  }
  return { chunkId, index, count, byteLength };
}

function decodeChunkPayload(data: unknown): Buffer {
  if (typeof data !== "string" || data.length === 0 || !BASE64_PATTERN.test(data)) {
    throw new Error("Invalid RPC chunk payload");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data) throw new Error("Invalid RPC chunk payload");
  return bytes;
}
