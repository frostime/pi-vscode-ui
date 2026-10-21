export type ProxyMode = "inherit" | "vscode" | "custom" | "direct";

export interface ProxyConfiguration {
  mode: ProxyMode;
  /** Single custom proxy endpoint. HTTP(S)/bare → HTTP_PROXY+HTTPS_PROXY; socks* → ALL_PROXY. */
  endpoint?: string;
  noProxy?: string;
}

/** Applied when custom/vscode modes do not set noProxy (empty string falls back here). */
export const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";
