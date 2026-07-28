import type { StreamingBehavior } from "@frostime/pi-rpc";

import type { ProxyConfiguration } from "../network/proxyConfiguration.js";

export interface FrostPiConfiguration {
  piExecutable?: string;
  piArguments: string[];
  startSessionOnOpen: boolean;
  streamingBehavior: StreamingBehavior;
  collapseTurnTrace: boolean;
  questionToolEnabled: boolean;
  maxImageBytes: number;
  diagnosticsLevel: "error" | "info" | "debug";
  experimentalNotificationsEnabled: boolean;
  proxy: ProxyConfiguration;
  fileMentionRespectSearchExclude: boolean;
  fileMentionRespectIgnoreFiles: boolean;
  fileMentionFollowSymlinks: boolean;
}
