/**
 * Reassembly of the chunked RPC frames an Oh My Pi child sends under protocol v2.
 *
 * Oh My Pi caps one JSONL line at `RPC_MAX_FRAME_BYTES` and, once protocol v2 is negotiated, splits
 * any larger logical frame into `rpc_chunk` frames carrying base64 payloads of at most
 * `RPC_CHUNK_PAYLOAD_BYTES`. Those chunks are the only way a runtime can deliver a response above
 * the line ceiling — for example the full entry list of a long session — so a client that negotiated
 * v2 must reassemble them before parsing the frame.
 */

/** Ceiling for one newline-delimited RPC frame, mirrored from the Oh My Pi framing contract. */
export const RPC_MAX_FRAME_BYTES = 1024 * 1024;
/** Ceiling for one logical frame reassembled from chunks, mirrored from the Oh My Pi framing contract. */
export const RPC_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;
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

export class RpcChunkAssembler {
  #pending: PendingChunks | null = null;

  reset(): void {
    this.#pending = null;
  }

  /**
   * Feed one parsed JSONL value. Returns the complete frame, or `undefined` while a chunk sequence
   * is still incomplete. Non-chunk values pass through untouched.
   */
  push(value: unknown): unknown {
    if (!isRpcChunkFrame(value)) {
      if (this.#pending) throw new Error("RPC chunk sequence interrupted");
      return value;
    }

    const { chunkId, index, count, byteLength } = readChunkMetadata(value);
    const payload = decodeChunkPayload(value.data);
    if (payload.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error("RPC chunk payload exceeds the transport limit");

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
  if (
    index < 0 ||
    count < 2 ||
    count > Math.ceil(RPC_MAX_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
    index >= count ||
    byteLength < RPC_MAX_FRAME_BYTES ||
    byteLength > RPC_MAX_REASSEMBLED_BYTES
  ) {
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
