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

`proxyConfiguration.ts` owns types/defaults, `extension/network` owns configuration and credential policy, and `packages/pi-rpc` owns generic environment merging.
