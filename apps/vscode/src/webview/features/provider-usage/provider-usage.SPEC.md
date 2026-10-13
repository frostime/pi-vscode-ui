# Provider usage presentation

## Boundary

This feature renders only safe `ProviderUsageDescriptor` and `ProviderUsageResult` values from `@frostime/provider-usage`. Its data-source interface accepts a provider scope and cancellation signal, never credentials, file paths, environment maps or transport hooks. Provider discovery, credential interpretation and request rules remain outside the browser.

The sidebar mounts a non-modal, dismissible usage surface without unmounting conversation or Composer. Its state belongs to the mounted component and is not persisted or attached to a Session. Closing restores the menu trigger's focus when it is still connected.

## Requests

Selecting a provider does not select a Pi model or automatically query usage. The current model's provider can preselect a configured entry; it does not establish account equivalence. Query/Refresh reloads provider discovery before requesting the selected scope. `all` is explicit.

Replacement, selection change, close and destruction cancel pending work. Even if the source ignores cancellation, late results cannot replace the current view. Old results are cleared before refresh; failures must not present them as current. Unexpected source failures use generic messages rather than raw exceptions.

## Report meaning

- Preserve provider labels, quota groups, window durations, reset timestamps and account/plan notes. Capture time is milliseconds; quota reset timestamps are seconds.
- Show only reported counters. Missing usage does not mean zero; draw a bar only with reported usage and an applicable scale. Clamp the visual bar, not the reported value.
- Keep currencies and balances separate. Do not derive subscription quota from spend or Session tokens.
- Reset availability is a plain metric, never a redemption control. Native ChatGPT's limited status/link result is not numerical quota.
- The UI explains that configured accounts can differ from model-specific or extension-injected runtime authentication.

All private chrome is component-scoped. Preserve keyboard reachability, close/Escape, independent result scrolling and usability at 280px in VS Code light/dark/high-contrast themes. See the cross-feature [UI specification](../../../../../../.dev/docs/design/ui-spec.md).
