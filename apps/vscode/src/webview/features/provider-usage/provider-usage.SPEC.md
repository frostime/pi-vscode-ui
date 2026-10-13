# Provider usage presentation

## Boundary

This feature renders only safe `ProviderUsageDescriptor` and `ProviderUsageResult` values from `@frostime/provider-usage`. Its data-source interface accepts a provider scope and cancellation signal, never credentials, file paths, environment maps or transport hooks. Provider discovery, credential interpretation and request rules remain outside the browser.

The sidebar's metrics row places Usage immediately left of Context. Clicking opens a compact non-modal popover above the row without unmounting conversation or Composer. Closing/Escape restores the Usage trigger's focus. Outside pointer actions dismiss without stealing focus from their target. Temporary preview data is visibly marked as mock.

## Requests

Opening selects and automatically queries the active provider when listed and ready. An unavailable current provider shows its reason; an unsupported provider leaves the selector unselected. Selecting another ready provider or `all` queries that scope without switching Pi models.

Successful reports are cached per provider for the metrics component/data-source lifetime, surviving popover close/reopen. The original snapshot timestamp is preserved; there is no expiry timer, background polling or disk/browser persistence. Source-category changes, disappearance or unavailability invalidate relevant snapshots. Same-source credential changes are not detectable from safe descriptors: use manual Refresh to re-query. Failed/cancelled requests are not cached. Manual Refresh invalidates the selected scope before requesting it, so a failed refresh cannot revive an old success. The Host uses the workspace-level Pi source; caches are keyed only by provider, not by Session or cwd.

Replacement, selection change, close and destruction cancel pending work. Even if the source ignores cancellation, late results cannot replace the current view. Old results are cleared before refresh; failures must not present them as current. Unexpected source failures use generic messages rather than raw exceptions.

## Report meaning

- Preserve provider labels, quota groups, window durations, reset timestamps and account/plan notes. Capture time is milliseconds; quota reset timestamps are seconds.
- Show only reported counters. Missing usage does not mean zero; draw a bar only with reported usage and an applicable scale. Clamp the visual bar, not the reported value.
- Keep currencies and balances separate. Do not derive subscription quota from spend or Session tokens.
- Reset availability is a plain metric, never a redemption control. Native ChatGPT's limited status/link result is not numerical quota.
- Quota rows show the window and used value once, with reset time and remaining value underneath. Full snapshot/reset timestamps remain available through time attributes/tooltips; technical source limitations live in collapsed About this data.

All private chrome is component-scoped. Preserve keyboard reachability, close/Escape, independent result scrolling and usability at 280px in VS Code light/dark/high-contrast themes. See the cross-feature [UI specification](../../../../../../.dev/docs/design/ui-spec.md).
