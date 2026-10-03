import type { StreamingBehavior } from "@frostime/pi-rpc";

import type { ProxyConfiguration } from "../network/proxyConfiguration.js";
import type { RuntimeCompatibility } from "./runtimeCompatibility.js";

export interface FrostPiConfiguration {
  piExecutable?: string;
  runtimeCompatibility: RuntimeCompatibility;
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
