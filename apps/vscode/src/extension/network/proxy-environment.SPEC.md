# Proxy environment lifecycle

`proxyConfiguration.ts` owns the proxy configuration types and default `NO_PROXY` value; proxy configuration UI remains under `extension/network`.

FrostPi proxy settings are process-start configuration.

- The guided command stores configuration at User or Workspace scope.
- A running Pi process never receives modified proxy settings.
- New sessions and restarted sessions resolve current settings and SecretStorage credentials.
- Changed settings mark running sessions `restart required`; the view distinguishes the currently applied label from the pending label.
- The session menu must display the active/pending proxy state and open the guided configuration flow.
- Credential changes remain restart-required until restart even if unrelated settings later change.
- Saving configuration never silently interrupts an active turn. The user explicitly chooses current-session restart, all-session restart, or later.
- `inherit` leaves the Extension Host environment unchanged.
- `vscode` maps VS Code `http.proxy` to HTTP_PROXY and HTTPS_PROXY and warns when that setting is empty.
- `custom` uses one `endpoint` setting. Bare `host:port` values are accepted in Settings and the guided wizard and normalized to `http://host:port` before writing env; explicit schemes are preserved. `http`/`https`/bare endpoints set both HTTP_PROXY and HTTPS_PROXY; `socks`/`socks5`/`socks5h` endpoints set ALL_PROXY only. The guided wizard asks only for the endpoint; `noProxy` is left at its setting/default unless edited in Settings.
- When `noProxy` is empty, `custom` and `vscode` modes set `NO_PROXY` to `localhost,127.0.0.1,::1`.
- `direct` removes upper- and lower-case proxy variables.
- Proxy variables apply to Pi and commands spawned by Pi. Third-party extensions that ignore those variables are outside FrostPi's guarantee.
- Diagnostics and exported stderr must redact credentials.
- Readers still accept legacy `network.proxy.http` / `https` / `all` values when `endpoint` is empty (`endpoint || http || https || all`). Writing custom mode through the guided command stores `endpoint` and clears those legacy keys.
