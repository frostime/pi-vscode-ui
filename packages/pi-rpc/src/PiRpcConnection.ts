import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { JsonlDecoder } from "./protocol/JsonlDecoder.js";
import { PiRpcCommandError, PiRpcProcessError, PiRpcProtocolError } from "./protocol/protocolErrors.js";
import { isRpcChunkFrame, RpcChunkAssembler } from "./protocol/RpcChunkAssembler.js";
import { isRpcMessage, isRpcResponse, type RpcCommand, type RpcEvent, type RpcResponse, type RpcSessionState } from "./protocol/rpcTypes.js";
import { BoundedTextBuffer } from "./process/processDiagnostics.js";
import { resolvePiExecutable } from "./process/resolvePiExecutable.js";
import { piRpcDialect } from "./dialects/pi/piRpcDialect.js";
import type { RpcDialect } from "./dialects/RpcDialect.js";

export interface PiRpcLaunchSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type PiRpcLauncher = (spec: PiRpcLaunchSpec) => ChildProcessWithoutNullStreams;

export interface PiRpcConnectionOptions {
  cwd: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  command?: string;
  commandArgs?: readonly string[];
  launcher?: PiRpcLauncher;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  stderrLimit?: number;
  dialect?: RpcDialect;
}

type EventListener = (event: RpcEvent) => void;
type FailureListener = (error: Error) => void;
type ExitListener = (exit: { code: number | null; signal: NodeJS.Signals | null }) => void;

type PendingRequest = {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 1_500;
const DEFAULT_STDERR_LIMIT = 64 * 1024;

export class PiRpcConnection {
  readonly #options: PiRpcConnectionOptions;
  readonly #eventListeners = new Set<EventListener>();
  readonly #failureListeners = new Set<FailureListener>();
  readonly #exitListeners = new Set<ExitListener>();
  readonly #pendingRequests = new Map<string, PendingRequest>();
  readonly #stderr: BoundedTextBuffer;
  readonly #dialect: RpcDialect;
  readonly #chunkAssembler = new RpcChunkAssembler();

  #child: ChildProcess | null = null;
  #decoder: JsonlDecoder | null = null;
  #requestId = 0;
  #failure: Error | null = null;
  #stopping = false;
  #chunkFramesEnabled = false;
  #startupReadyPromise: Promise<void> = Promise.resolve();
  #resolveStartupReady: (() => void) | null = null;
  #rejectStartupReady: ((error: Error) => void) | null = null;

  constructor(options: PiRpcConnectionOptions) {
    this.#options = options;
    this.#stderr = new BoundedTextBuffer(options.stderrLimit ?? DEFAULT_STDERR_LIMIT);
    this.#dialect = options.dialect ?? piRpcDialect;
  }

  get started(): boolean {
    return this.#child !== null;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  getStderr(): string {
    return this.#stderr.toString();
  }

  async start(): Promise<RpcSessionState> {
    if (this.#child) throw new Error("Pi RPC connection is already started");

    this.#failure = null;
    this.#stopping = false;
    this.#stderr.clear();
    this.#chunkFramesEnabled = false;
    this.#chunkAssembler.reset();
    this.#startupReadyPromise = this.#dialect.requiresStartupReady
      ? new Promise<void>((resolve, reject) => {
          this.#resolveStartupReady = resolve;
          this.#rejectStartupReady = reject;
        })
      : Promise.resolve();
    this.#decoder = new JsonlDecoder((record) => this.#handleRecord(record));

    const invocation = resolvePiExecutable({
      ...(this.#options.command ? { command: this.#options.command } : {}),
      ...(this.#options.commandArgs ? { commandArgs: this.#options.commandArgs } : {}),
    });
    const spec: PiRpcLaunchSpec = {
      command: invocation.command,
      args: [...invocation.args, "--mode", "rpc", ...(this.#options.args ?? [])],
      cwd: this.#options.cwd,
      env: mergeEnvironment(process.env, this.#options.env),
    };
    const child = this.#options.launcher
      ? this.#options.launcher(spec)
      : spawn(spec.command, [...spec.args], {
          cwd: spec.cwd,
          env: spec.env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
    this.#child = child;

    child.stdout.on("data", (chunk: Buffer) => this.#decoder?.push(chunk));
    child.stdout.on("end", () => this.#decoder?.end());
    child.stderr.on("data", (chunk: Buffer) => this.#stderr.append(chunk.toString()));
    child.once("error", (error) => this.#fail(new PiRpcProcessError(`Pi process error: ${error.message}`)));
    child.stdin.on("error", (error) => this.#fail(new PiRpcProcessError(`Pi process stdin error: ${error.message}`)));
    child.once("close", (code, signal) => this.#handleClose(child, code, signal));

    try {
      await this.#waitForStartupReady(this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
      if (this.#dialect.startupNegotiation) {
        this.#chunkFramesEnabled = true;
        const negotiationData = await this.request(this.#dialect.startupNegotiation, this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
        this.#dialect.validateNegotiationResponse?.(negotiationData);
      }
      return await this.request<RpcSessionState>(
        { type: "get_state" },
        this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      );
    } catch (error) {
      await this.stop();
      throw this.#withStderr(asError(error));
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;

    this.#stopping = true;
    this.#rejectPending(new PiRpcProcessError("Pi RPC connection stopped"));
    if (child.exitCode !== null) return;

    child.kill("SIGTERM");
    if (await waitForClose(child, this.#options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)) return;
    child.kill("SIGKILL");
    await waitForClose(child, this.#options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
  }

  onEvent(listener: EventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onFailure(listener: FailureListener): () => void {
    this.#failureListeners.add(listener);
    return () => this.#failureListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  async request<T = unknown>(command: RpcCommand, timeoutMs?: number | null): Promise<T> {
    const child = this.#child;
    const stdin = child?.stdin;
    if (!child || !stdin) throw new PiRpcProcessError("Pi RPC connection is not started");
    if (this.#failure) throw this.#withStderr(this.#failure);
    if (child.exitCode !== null || stdin.destroyed || !stdin.writable) {
      throw this.#withStderr(new PiRpcProcessError("Pi RPC process stdin is not writable"));
    }

    const id = `req_${++this.#requestId}`;
    const deadline = timeoutMs === null ? null : timeoutMs ?? this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const timer = deadline === null ? null : setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(this.#withStderr(new PiRpcCommandError(`Timed out waiting for ${command.type} response after ${deadline}ms`, command.type)));
      }, deadline);
      this.#pendingRequests.set(id, { resolve, reject, timer });
      void this.sendNotification({ ...command, id }).catch((error) => {
        const pending = this.#pendingRequests.get(id);
        if (!pending) return;
        this.#pendingRequests.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(asError(error));
      });
    });

    if (!response.success) {
      throw this.#withStderr(new PiRpcCommandError(response.error ?? `${command.type} failed`, command.type));
    }
    return response.data as T;
  }

  sendNotification(command: RpcCommand): Promise<void> {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return Promise.reject(this.#withStderr(new PiRpcProcessError("Pi RPC process stdin is not writable")));
    }

    return new Promise((resolve, reject) => {
      try {
        stdin.write(`${JSON.stringify(command)}\n`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(asError(error));
      }
    });
  }

  #handleRecord(record: string): void {
    let value: unknown;
    try {
      value = JSON.parse(record);
      if (isRpcChunkFrame(value) && !this.#chunkFramesEnabled) {
        throw new Error("RPC chunk received before protocol negotiation");
      }
      value = this.#chunkAssembler.push(value);
      if (value === undefined) return;
      if (!isRpcMessage(value)) throw new Error("Invalid RPC message from Pi");
      if (this.#dialect.acceptStartupFrame(value)) {
        this.#resolveStartupReady?.();
        this.#resolveStartupReady = null;
        this.#rejectStartupReady = null;
        return;
      }
    } catch (error) {
      this.#fatalProtocolError(`Invalid RPC frame from Pi: ${asError(error).message}`);
      return;
    }

    if (isRpcResponse(value) && typeof value.id === "string") {
      const pending = this.#pendingRequests.get(value.id);
      if (!pending) return;
      this.#pendingRequests.delete(value.id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve(value);
      return;
    }

    const event = this.#dialect.normalizeEvent(value);
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // A consumer cannot interrupt protocol processing for other consumers.
      }
    }
  }

  #handleClose(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#child !== child) return;
    this.#decoder?.end();
    this.#child = null;
    for (const listener of this.#exitListeners) {
      try {
        listener({ code, signal });
      } catch {
        // Exit listeners are observability hooks.
      }
    }
    if (!this.#stopping) this.#fail(new PiRpcProcessError(`Pi RPC process exited (code=${code} signal=${signal})`));
  }

  async #waitForStartupReady(timeoutMs: number): Promise<void> {
    if (!this.#dialect.requiresStartupReady) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#startupReadyPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new PiRpcProtocolError("Timed out waiting for RPC ready frame")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #fatalProtocolError(message: string): void {
    const error = this.#withStderr(new PiRpcProtocolError(message));
    this.#rejectStartupReady?.(error);
    this.#resolveStartupReady = null;
    this.#rejectStartupReady = null;
    this.#fail(error);
    this.#child?.kill("SIGTERM");
  }

  #fail(error: Error): void {
    this.#rejectStartupReady?.(error);
    this.#resolveStartupReady = null;
    this.#rejectStartupReady = null;
    const isFirstFailure = this.#failure === null;
    if (!this.#failure) this.#failure = error;
    this.#rejectPending(this.#failure);
    if (!isFirstFailure || this.#stopping) return;
    for (const listener of this.#failureListeners) {
      try {
        listener(this.#failure);
      } catch {
        // Failure listeners are diagnostic hooks.
      }
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pendingRequests.clear();
  }

  #withStderr(error: Error): Error {
    const stderr = this.#stderr.toString().trim();
    if (!stderr || error.message.includes("Stderr:")) return error;
    return Object.assign(new Error(`${error.message}. Stderr: ${stderr}`), { name: error.name, cause: error });
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
  });
}

export function mergeEnvironment(base: NodeJS.ProcessEnv, overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
