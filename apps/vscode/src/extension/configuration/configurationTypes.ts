import type { StreamingBehavior } from "@frostime/pi-rpc";

export type ProxyMode = "inherit" | "vscode" | "custom" | "direct";

export interface ProxyConfiguration {
  mode: ProxyMode;
  /** Single custom proxy endpoint. HTTP(S)/bare → HTTP_PROXY+HTTPS_PROXY; socks* → ALL_PROXY. */
  endpoint?: string;
  noProxy?: string;
}

export interface FrostPiConfiguration {
  piExecutable?: string;
  piArguments: string[];
  startSessionOnOpen: boolean;
  streamingBehavior: StreamingBehavior;
  collapseTurnTrace: boolean;
  questionToolEnabled: boolean;
  maxImageBytes: number;
  diagnosticsLevel: "error" | "info" | "debug";
  proxy: ProxyConfiguration;
  fileMentionRespectSearchExclude: boolean;
  fileMentionRespectIgnoreFiles: boolean;
  fileMentionFollowSymlinks: boolean;
}
