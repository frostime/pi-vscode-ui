import type { RpcModel } from "@frostime/pi-rpc";

export const CACHE_MISS_IDLE_TTL_MS = 5 * 60 * 1_000;

const CACHE_MISS_NOISE_FLOOR_TOKENS = 1_024;
const CACHE_MISS_NOTICE_MIN_TOKENS = 20_000;
const CACHE_MISS_NOTICE_MIN_COST = 0.1;

export interface CacheMiss {
  missedTokens: number;
  missedCost: number;
  idleMs: number;
  modelChanged: boolean;
}

interface PreviousCacheRequest {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  reportedCache: boolean;
}

export interface CacheAnalysisState {
  readonly previousRequest?: PreviousCacheRequest;
}

export interface CacheAnalysisResult {
  state: CacheAnalysisState;
  miss?: CacheMiss;
}

interface PromptCacheUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

interface CacheRequestSample {
  provider: string;
  model: string;
  timestamp: number;
  usage: PromptCacheUsage & {
    cost?: {
      input: number;
      cacheRead: number;
      cacheWrite: number;
    };
  };
}

export function emptyCacheAnalysis(): CacheAnalysisState {
  return {};
}

export function assistantCacheHitPercent(message: unknown): number | undefined {
  const usage = promptCacheUsage(message);
  if (!usage) return undefined;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

/** Analyze one completed assistant request and return the baseline for the next request. */
export function advanceCacheAnalysis(
  state: CacheAnalysisState,
  message: unknown,
  models: readonly RpcModel[] = [],
): CacheAnalysisResult {
  const sample = cacheRequestSample(message);
  if (!sample) return { state };

  const { input, cacheRead, cacheWrite } = sample.usage;
  const promptTokens = input + cacheRead + cacheWrite;
  if (promptTokens <= 0) return { state };

  const previous = state.previousRequest;
  const nextState: CacheAnalysisState = {
    previousRequest: {
      promptTokens,
      modelKey: modelKey(sample),
      timestamp: sample.timestamp,
      reportedCache: (previous?.reportedCache ?? false) || cacheRead + cacheWrite > 0,
    },
  };
  if (!previous || (cacheRead + cacheWrite === 0 && !previous.reportedCache)) {
    return { state: nextState };
  }

  const missedTokens = Math.min(previous.promptTokens, promptTokens) - cacheRead;
  if (missedTokens <= CACHE_MISS_NOISE_FLOOR_TOKENS) return { state: nextState };

  const paidTokens = input + cacheWrite;
  const paidPerToken = paidTokens > 0 && sample.usage.cost
    ? (sample.usage.cost.input + sample.usage.cost.cacheWrite) / paidTokens
    : 0;
  const readPerToken = cacheRead > 0 && sample.usage.cost
    ? sample.usage.cost.cacheRead / cacheRead
    : modelCacheReadCost(models, sample.provider, sample.model) / 1_000_000;

  return {
    state: nextState,
    miss: {
      missedTokens,
      missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
      idleMs: Math.max(0, sample.timestamp - previous.timestamp),
      modelChanged: modelKey(sample) !== previous.modelKey,
    },
  };
}

export function isSignificantCacheMiss(miss: CacheMiss): boolean {
  return miss.missedTokens >= CACHE_MISS_NOTICE_MIN_TOKENS || miss.missedCost >= CACHE_MISS_NOTICE_MIN_COST;
}

function cacheRequestSample(value: unknown): CacheRequestSample | undefined {
  if (!isRecord(value) || value.role !== "assistant") return undefined;
  if (typeof value.provider !== "string" || typeof value.model !== "string" || !isNonNegativeNumber(value.timestamp)) {
    return undefined;
  }

  const usage = promptCacheUsage(value);
  if (!usage) return undefined;
  const rawUsage = isRecord(value.usage) ? value.usage : undefined;
  const rawCost = rawUsage && isRecord(rawUsage.cost) ? rawUsage.cost : undefined;
  const cost = rawCost
    && isNonNegativeNumber(rawCost.input)
    && isNonNegativeNumber(rawCost.cacheRead)
    && isNonNegativeNumber(rawCost.cacheWrite)
    ? { input: rawCost.input, cacheRead: rawCost.cacheRead, cacheWrite: rawCost.cacheWrite }
    : undefined;

  return {
    provider: value.provider,
    model: value.model,
    timestamp: value.timestamp,
    usage: { ...usage, ...(cost ? { cost } : {}) },
  };
}

function promptCacheUsage(message: unknown): PromptCacheUsage | undefined {
  if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage)) return undefined;
  const { input, cacheRead, cacheWrite } = message.usage;
  if (!isNonNegativeNumber(input) || !isNonNegativeNumber(cacheRead) || !isNonNegativeNumber(cacheWrite)) {
    return undefined;
  }
  return { input, cacheRead, cacheWrite };
}

function modelCacheReadCost(models: readonly RpcModel[], provider: string, model: string): number {
  const match = models.find((candidate) => candidate.provider === provider && candidate.id === model);
  if (!match || !isRecord(match.cost) || !isNonNegativeNumber(match.cost.cacheRead)) return 0;
  return match.cost.cacheRead;
}

function modelKey(sample: Pick<CacheRequestSample, "provider" | "model">): string {
  return `${sample.provider}/${sample.model}`;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
