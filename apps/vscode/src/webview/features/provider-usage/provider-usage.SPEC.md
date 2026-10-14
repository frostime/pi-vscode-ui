# Provider usage presentation

## Boundary

This feature renders only safe `ProviderUsageDescriptor` and `ProviderUsageResult` values from `@frostime/provider-usage`. Its data-source interface accepts a provider scope and cancellation signal, never credentials, file paths, environment maps or transport hooks. Provider discovery, credential interpretation and request rules remain outside the browser.

The sidebar's metrics row places the chart-icon Usage trigger immediately left of the ring-icon Context trigger, with matched compact transparent button styling. Context percentage and session cost are shown in the Context popover, not repeated in the metrics row. Clicking opens a compact non-modal popover above the row without unmounting conversation or Composer. Closing/Escape restores the Usage trigger's focus. Outside pointer actions dismiss without stealing focus from their target.

## Requests

The source lists the full supported catalog, including entries without configured credentials. Opening selects the active provider and automatically queries it when ready. If absent from the complete catalog, the current Provider remains selected with an explicit unsupported message and no usage query. If present but unavailable, show “Could not obtain credentials” rather than asserting the user configured no credentials. The selector offers configured Providers plus the current Provider; it does not list every unconfigured definition. `all` includes configured Providers only. Selecting another ready Provider or `all` queries that scope without switching Pi models.

Unavailable credentials expose a subdued Details toggle containing the safe package reason, supported credential sources (auth.json, provider-level models.json and Host environment), and the limitation on dynamically injected extension credentials. The explanation states that this feature uses credentials only for usage queries, does not log them or send them to an LLM, and does not save additional copies. Do not show a general About this data disclosure or credential-source implementation details on successful reports.

Successful reports are cached per provider for the metrics component/data-source lifetime, surviving popover close/reopen. The original snapshot timestamp is preserved; there is no expiry timer, background polling or disk/browser persistence. Source-category changes, disappearance or unavailability invalidate relevant snapshots. Same-source credential changes are not detectable from safe descriptors: use manual Refresh to re-query. Failed/cancelled requests are not cached. Manual Refresh invalidates the selected scope before requesting it, so a failed refresh cannot revive an old success. The Host uses the workspace-level Pi source; caches are keyed only by provider, not by Session or cwd.

Replacement, selection change, close and destruction cancel pending work. Even if the source ignores cancellation, late results cannot replace the current view. Old results are cleared before refresh; failures must not present them as current. Unexpected source failures use generic messages rather than raw exceptions.

## Report meaning

- Preserve provider labels, quota groups, window durations, reset timestamps and account/plan notes. Capture time is milliseconds; quota reset timestamps are seconds.
- Official-page navigation comes from optional descriptor `links` populated by the package’s predefined Provider metadata. Render labels and send URLs through the existing `openExternal` action. Do not infer links from notes or Provider IDs. A selected Provider’s links remain accessible without a successful query; `all` displays links with each result.
- Show only reported counters. Missing usage does not mean zero; draw a bar only with reported usage and an applicable scale. Clamp the visual bar, not the reported value.
- Keep currencies and balances separate. Do not derive subscription quota from spend or Session tokens.
- Reset availability is a plain metric, never a redemption control. Native ChatGPT's limited status/link result is not numerical quota.
- Quota rows show the window and used value once, with reset time and remaining value underneath. Full snapshot/reset timestamps remain available through time attributes/tooltips.

All private chrome is component-scoped. Preserve keyboard reachability, close/Escape, independent result scrolling and usability at 280px in VS Code light/dark/high-contrast themes. See the cross-feature [UI specification](../../../../../../.dev/docs/design/ui-spec.md).
