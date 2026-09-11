import type { RpcModel } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import {
  advanceCacheAnalysis,
  CACHE_MISS_IDLE_TTL_MS,
  emptyCacheAnalysis,
  isSignificantCacheMiss,
} from "../../src/extension/conversation/cacheMissDetection.js";

const models: RpcModel[] = [
  {
    provider: "anthropic",
    id: "claude",
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  {
    provider: "openai",
    id: "gpt",
    cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2 },
  },
];

describe("cache miss detection", () => {
  it("reports each completed request against the immediately preceding eligible request", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 29_000,
      cacheWrite: 1_000,
      inputCost: 0.087,
      cacheWriteCost: 0.00375,
    }), models);
    expect(first.miss).toBeUndefined();

    const second = advanceCacheAnalysis(first.state, assistant({
      timestamp: 2,
      input: 25_000,
      cacheRead: 5_000,
      inputCost: 0.075,
      cacheReadCost: 0.0015,
    }), models);
    expect(second.miss).toEqual({
      missedTokens: 25_000,
      missedCost: 0.0675,
      idleMs: 1,
      modelChanged: false,
    });

    const third = advanceCacheAnalysis(second.state, assistant({
      timestamp: 3,
      input: 28_000,
      cacheRead: 2_000,
      inputCost: 0.084,
      cacheReadCost: 0.0006,
    }), models);
    expect(third.miss).toEqual({
      missedTokens: 28_000,
      missedCost: 0.0756,
      idleMs: 1,
      modelChanged: false,
    });
  });

  it("does not infer misses for a provider that has never reported cache activity", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({ timestamp: 1, input: 10_000 }), models);
    const second = advanceCacheAnalysis(first.state, assistant({ timestamp: 2, input: 11_000 }), models);

    expect(second.miss).toBeUndefined();
  });

  it("suppresses cache-breakpoint noise while advancing the next-request baseline", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 9_000,
      cacheWrite: 1_000,
    }), models);
    const noise = advanceCacheAnalysis(first.state, assistant({
      timestamp: 2,
      input: 1_024,
      cacheRead: 8_976,
    }), models);
    const afterNoise = advanceCacheAnalysis(noise.state, assistant({
      timestamp: 3,
      input: 5_000,
      cacheRead: 5_000,
      inputCost: 0.015,
      cacheReadCost: 0.0015,
    }), models);

    expect(noise.miss).toBeUndefined();
    expect(afterNoise.miss?.missedTokens).toBe(5_000);
  });

  it("reports idle duration and model changes using the completed message metadata", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 19_000,
      cacheWrite: 1_000,
    }), models);
    const changed = advanceCacheAnalysis(first.state, assistant({
      provider: "openai",
      model: "gpt",
      timestamp: CACHE_MISS_IDLE_TTL_MS + 1,
      input: 10_000,
      cacheRead: 5_000,
      inputCost: 0.02,
      cacheReadCost: 0.001,
    }), models);

    expect(changed.miss).toMatchObject({
      missedTokens: 10_000,
      idleMs: CACHE_MISS_IDLE_TTL_MS,
      modelChanged: true,
    });
  });

  it("uses the model cache-read rate to price a total miss", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 9_000,
      cacheWrite: 1_000,
    }), models);
    const missed = advanceCacheAnalysis(first.state, assistant({
      timestamp: 2,
      input: 10_000,
      inputCost: 0.03,
    }), models);

    expect(missed.miss).toMatchObject({ missedTokens: 10_000, missedCost: 0.027 });
  });

  it("keeps token analysis usable when an otherwise valid usage omits cost", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 9_000,
      cacheWrite: 1_000,
      omitCost: true,
    }), models);
    const missed = advanceCacheAnalysis(first.state, assistant({
      timestamp: 2,
      input: 10_000,
      omitCost: true,
    }), models);

    expect(missed.miss).toMatchObject({ missedTokens: 10_000, missedCost: 0 });
  });

  it("ignores malformed messages without discarding the previous valid baseline", () => {
    const first = advanceCacheAnalysis(emptyCacheAnalysis(), assistant({
      timestamp: 1,
      input: 9_000,
      cacheWrite: 1_000,
    }), models);
    const malformed = advanceCacheAnalysis(first.state, {
      role: "assistant",
      provider: "anthropic",
      model: "claude",
      timestamp: 2,
      usage: { input: "invalid" },
    }, models);
    const next = advanceCacheAnalysis(malformed.state, assistant({
      timestamp: 3,
      input: 10_000,
      inputCost: 0.03,
    }), models);

    expect(malformed.state).toBe(first.state);
    expect(next.miss?.missedTokens).toBe(10_000);
  });

  it("matches Pi's transcript-notice significance threshold", () => {
    expect(isSignificantCacheMiss({ missedTokens: 20_000, missedCost: 0, idleMs: 0, modelChanged: false })).toBe(true);
    expect(isSignificantCacheMiss({ missedTokens: 1_025, missedCost: 0.1, idleMs: 0, modelChanged: false })).toBe(true);
    expect(isSignificantCacheMiss({ missedTokens: 19_999, missedCost: 0.099, idleMs: 0, modelChanged: false })).toBe(false);
  });
});

function assistant(options: {
  provider?: string;
  model?: string;
  timestamp: number;
  input: number;
  cacheRead?: number;
  cacheWrite?: number;
  inputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  omitCost?: boolean;
}): Record<string, unknown> {
  return {
    role: "assistant",
    provider: options.provider ?? "anthropic",
    model: options.model ?? "claude",
    timestamp: options.timestamp,
    content: [],
    usage: {
      input: options.input,
      output: 0,
      cacheRead: options.cacheRead ?? 0,
      cacheWrite: options.cacheWrite ?? 0,
      totalTokens: options.input + (options.cacheRead ?? 0) + (options.cacheWrite ?? 0),
      ...(options.omitCost ? {} : {
        cost: {
          input: options.inputCost ?? 0,
          output: 0,
          cacheRead: options.cacheReadCost ?? 0,
          cacheWrite: options.cacheWriteCost ?? 0,
          total: 0,
        },
      }),
    },
  };
}
