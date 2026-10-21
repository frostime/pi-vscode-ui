import type { RpcModel, ThinkingLevel } from "@frostime/pi-rpc";

export interface ThinkingLevelOption {
  level: ThinkingLevel;
  label: string;
  description: string;
}

const ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const COPY: Record<ThinkingLevel, Omit<ThinkingLevelOption, "level">> = {
  off: { label: "Off", description: "No explicit reasoning effort" },
  minimal: { label: "Minimal", description: "Fastest reasoning" },
  low: { label: "Low", description: "Light reasoning" },
  medium: { label: "Medium", description: "Balanced reasoning" },
  high: { label: "High", description: "Deeper reasoning" },
  xhigh: { label: "Extra high", description: "Extended reasoning" },
  max: { label: "Maximum", description: "Highest model-supported effort" },
};

/**
 * Mirrors Pi's model metadata semantics without owning provider policy.
 * Standard levels through `high` are available by default for reasoning models,
 * while `xhigh` and `max` are opt-in. A `null` mapping explicitly removes a level.
 */
export function getSupportedThinkingLevels(model: RpcModel | null): ThinkingLevelOption[] {
  if (!model?.reasoning) return [option("off")];

  const map = record(model.thinkingLevelMap);
  const levels = ORDER.filter((level) => {
    if (map && Object.hasOwn(map, level)) return map[level] !== null;
    return level !== "xhigh" && level !== "max";
  });

  // Be conservative with malformed custom metadata: a reasoning model should
  // always expose at least one valid choice rather than rendering a dead control.
  const supported: ThinkingLevel[] = levels.length ? levels : ["off"];
  return supported.map(option);
}

export function normalizeThinkingLevel(model: RpcModel | null, current: ThinkingLevel): ThinkingLevel {
  const levels = getSupportedThinkingLevels(model).map(({ level }) => level);
  return levels.includes(current) ? current : levels.at(-1) ?? "off";
}

function option(level: ThinkingLevel): ThinkingLevelOption {
  return { level, ...COPY[level] };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
