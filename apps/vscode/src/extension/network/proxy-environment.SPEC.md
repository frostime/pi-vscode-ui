# Proxy environment lifecycle

Proxy policy is resolved only when a Pi process starts. New and restarted sessions use current settings plus `SecretStorage` credentials; a running process is never mutated.

- Saving a change marks affected running sessions restart-required and never interrupts an active turn. The user chooses current-session restart, all-session restart, or later; credential changes remain pending until restart.
- `inherit` preserves the Extension Host environment. `direct` deletes upper- and lower-case proxy variables from the child environment.
- `vscode` maps VS Code `http.proxy` to `HTTP_PROXY` and `HTTPS_PROXY` and reports an empty setting.
- `custom` accepts one endpoint; bare `host:port` is normalized to `http://host:port`. HTTP(S)/bare endpoints set `HTTP_PROXY` and `HTTPS_PROXY`; SOCKS endpoints set `ALL_PROXY` only.
- Empty `noProxy` in `custom` or `vscode` mode uses `localhost,127.0.0.1,::1`.
- Proxy variables apply to Pi and inheriting child commands; third-party extensions that ignore them are outside FrostPi's guarantee.
- Credentials remain in VS Code `SecretStorage`, and diagnostics/exported stderr redact them.
- Readers preserve legacy `network.proxy.http` / `https` / `all` fallback when `endpoint` is empty; guided custom-mode writes store `endpoint` and clear those legacy keys.

`apps/pi-client/src/core/network` owns proxy types/defaults and pure environment calculation; `extension/network` owns VS Code configuration and credential storage/policy, and `packages/pi-rpc` owns generic environment merging. Runtime receives a live host-proxy reader and a read-only credential provider rather than importing VS Code storage or configuration.

## Provider usage requests

Usage requests read current workspace-scoped FrostPi proxy settings and SecretStorage
credentials for each actual query. They do not use a running Pi process's environment
snapshot or require a Pi restart. In-flight requests are not reconfigured; cached
provider snapshots remain unchanged until Refresh or an otherwise needed query.
Configuration scope is the stable workspace root, not Session cwd.

The Host supplies a local environment copy to the standalone package. Inherit keeps
Host proxy variables; direct removes both cases of all proxy variables. Custom/VS Code
modes replace inherited proxy variables before applying the existing endpoint,
credential and NO_PROXY rules. Empty explicit endpoints fail without a request.
HTTP(S) proxies are supported; SOCKS remains an explicit package error, never a
fallback to inherited HTTP proxy or direct traffic. No global environment/dispatcher
is changed, and no proxy URL or credential crosses the bridge.
