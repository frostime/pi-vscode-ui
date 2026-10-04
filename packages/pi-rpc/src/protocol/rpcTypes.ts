export interface RpcImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type StreamingBehavior = "steer" | "followUp";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RpcCommand {
  type: string;
  [key: string]: unknown;
}

export interface RpcResponse<T = unknown> {
  type: "response";
  id?: string;
  command?: string;
  success: boolean;
  data?: T;
  error?: string;
}

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

export interface RpcModel {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  supportsImages?: boolean;
  reasoning?: boolean;
  [key: string]: unknown;
}

export interface RpcSessionState {
  model: RpcModel | null;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
  [key: string]: unknown;
}

export interface RpcSourceInfo {
  path: string;
  source: string;
  scope: string;
  origin: string;
  baseDir?: string;
  [key: string]: unknown;
}

export interface RpcCommandDescriptor {
  name: string;
  description?: string;
  source: string;
  /** Original OMP category when discovery adapts a supported command. */
  runtimeSource?: "file" | "skill";
  sourceInfo?: RpcSourceInfo;
  location?: string;
  path?: string;
  [key: string]: unknown;
}

export interface RpcForkResult {
  text: string;
  cancelled: boolean;
}

export interface RpcSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  [key: string]: unknown;
}

export interface RpcSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export interface RpcExtensionUiRequest extends RpcEvent {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor";
  text?: string;
}

export type RpcExtensionUiResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

export function isRpcMessage(value: unknown): value is Record<string, unknown> & { type: string } {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  return (
    isRpcMessage(value) &&
    value.type === "response" &&
    typeof value.success === "boolean" &&
    (value.id === undefined || typeof value.id === "string")
  );
}

export function isExtensionUiRequest(value: RpcEvent): value is RpcExtensionUiRequest {
  return value.type === "extension_ui_request" && typeof value.id === "string" && typeof value.method === "string";
}
