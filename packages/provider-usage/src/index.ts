/**
 * Public entrypoint of `@frostime/provider-usage`.
 *
 * Phase 1 exposes the credential-resolution core only:
 * - `resolveProviderCredentials` — trusted Node output with real credentials;
 * - `listProviders` — safe descriptors for application/UI surfaces.
 *
 * The HTTP/query surface and `queryUsage` arrive in Phase 2. There is no
 * provider HTTP access, OAuth refresh or command execution in this phase, and
 * the implementation never imports Pi SDK code or reads process-spy state.
 */
export { listProviders } from "./listProviders.js";
export type { ProviderUsageDescriptor } from "./types.js";
export {
  resolveProviderCredentials,
  type ResolutionInput,
} from "./configuration.js";
export type {
  ProviderResolutionInput,
  ProviderSourceCategory,
  ReadyProviderCredential,
  ResolvedProviderCredential,
  UnavailableProviderCredential,
} from "./types.js";
export { maskEnvName, maskSecret, redactWithSecrets, sanitizeDisplayText } from "./masking.js";
