// Report/payload contracts adapted from pi-provider-usage; no Pi runtime types.
import type { UsageReport, UsageSemantics } from "./publicTypes.js";

export type { UsageSemanticsKind, UsageUnit, UsageSemantics, UsageBucket, UsageMetric, UsageReport } from "./publicTypes.js";

/** Explicit request headers used by the adapted Fireworks account adapter. */
export interface ResolvedUsageAuth {
  headers: Record<string, string>;
}

export type UsageRequestGuard = () => Promise<void>;

export interface UsageProviderTarget {
  id: string;
  label: string;
  description?: string;
}

export interface UsageTargetResolver {
  singularLabel: string;
  pluralLabel: string;
  list(
    auth: ResolvedUsageAuth,
    signal: AbortSignal,
    timeoutMs: number,
    guard: UsageRequestGuard,
  ): Promise<readonly UsageProviderTarget[]>;
}

export interface UsageProviderAdapter {
  id: string;
  displayName: string;
  semantics: UsageSemantics;
  targets?: UsageTargetResolver;
  query(
    auth: ResolvedUsageAuth,
    signal: AbortSignal,
    timeoutMs: number,
    guard?: UsageRequestGuard,
    targetId?: string,
  ): Promise<UsageReport>;
}

export type BasetenBillingUsagePayload = {
  dedicated_usage?: unknown;
  model_apis_usage?: unknown;
  training_usage?: unknown;
};

export type DeepSeekBalancePayload = {
  is_available?: unknown;
  balance_infos?: unknown;
};

export type FireworksAccountsPayload = {
  accounts?: unknown;
  nextPageToken?: unknown;
};

export type FireworksBillingSummaryPayload = {
  lineItems?: unknown;
};

export type GitHubCopilotUsagePayload = {
  login?: unknown;
  copilot_plan?: unknown;
  access_type_sku?: unknown;
  limited_user_quotas?: unknown;
  limited_user_reset_date?: unknown;
  monthly_quotas?: unknown;
  quota_reset_date?: unknown;
  quota_reset_date_utc?: unknown;
  quota_snapshots?: unknown;
};

export type OpenRouterKeyPayload = {
  data?: unknown;
};

export type MiniMaxUsagePayload = {
  available_amount?: unknown;
  balance_alert_switch?: unknown;
  balance_alert_threshold?: unknown;
  base_resp?: unknown;
  cash_balance?: unknown;
  credit_balance?: unknown;
  model_remains?: unknown;
  owed_amount?: unknown;
  voucher_balance?: unknown;
};

export type MoonshotBalancePayload = {
  code?: unknown;
  data?: unknown;
  scode?: unknown;
  status?: unknown;
};

export type VercelAIGatewayCreditsPayload = {
  balance?: unknown;
  total_used?: unknown;
};

export type OpenCodeZenPayload = {
  usage?: unknown;
};

export type ZaiQuotaPayload = {
  error?: unknown;
  code?: unknown;
  success?: unknown;
  data?: unknown;
};

export type ZaiSubscriptionPayload = {
  error?: unknown;
  code?: unknown;
  success?: unknown;
  data?: unknown;
};

export interface ZaiPlanInfo {
  name: string;
  renewsAt?: string;
}

export type KimiCodingUsagePayload = {
  usage?: unknown;
  limits?: unknown;
  usages?: unknown;
  boosterWallet?: unknown;
  booster_wallet?: unknown;
};

export type XaiUserPayload = {
  userId?: unknown;
  subscriptionTier?: unknown;
};

export type XaiBillingPayload = {
  config?: unknown;
};

export type CodexBackendPayload = {
  plan_type?: unknown;
  rate_limit?: unknown;
  additional_rate_limits?: unknown;
  credits?: unknown;
  rate_limit_reset_credits?: unknown;
};
