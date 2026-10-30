// Serializable report contracts; no provider transport or platform globals.
export type UsageSemanticsKind = "consumer-subscription" | "api-key" | "project";
export type UsageUnit = "percent" | "usd" | "currency" | "count";

export interface UsageSemantics {
  kind: UsageSemanticsKind;
  label: string;
}

export interface UsageBucket {
  id: string;
  label: string;
  groupId?: string;
  groupLabel?: string;
  modelKeys?: string[];
  used?: number;
  remaining?: number;
  limit?: number;
  unit: UsageUnit;
  period?: string | undefined;
  windowMinutes?: number;
  /** Unix timestamp in seconds, as reported by the source adapters. */
  resetsAt?: number;
}

export interface UsageMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: UsageUnit;
  currency?: string;
}

export interface UsageReport {
  providerId: string;
  providerName: string;
  /** Unix timestamp in milliseconds for this query snapshot. */
  capturedAt: number;
  source: string;
  semantics: UsageSemantics;
  accountLabel?: string | undefined;
  buckets: UsageBucket[];
  metrics: UsageMetric[];
  notes?: string[];
}

/** Safe source category; never contains environment variable names. */
export type ProviderSourceCategory = "auth.json" | "models.json" | "environment" | "not-configured";

/** Fixed official navigation metadata, never extracted from provider responses. */
export interface ProviderUsageLink {
  label: string;
  url: string;
}

/** Browser-safe description without credentials, variable names or file content. */
export interface ProviderUsageDescriptor {
  providerId: string;
  displayName: string;
  availability: "ready" | "unavailable";
  links?: readonly ProviderUsageLink[];
  source: ProviderSourceCategory;
  /** Safe reason; sanitized and always present for unavailable results. */
  reason: string;
}

export type ProviderUsageResult =
  | { providerId: string; status: "ready"; source: ProviderSourceCategory; report: UsageReport }
  | { providerId: string; status: "unavailable" | "query-failed" | "selection-required"; source: ProviderSourceCategory; reason: string };
