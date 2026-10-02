import { homedir } from "node:os";
import { join } from "node:path";

export const RUNTIME_COMPATIBILITIES = ["pi", "oh-my-pi"] as const;
export type RuntimeCompatibility = (typeof RUNTIME_COMPATIBILITIES)[number];

export interface RuntimeCapabilities {
  readonly sessionTree: boolean;
  readonly fork: boolean;
  readonly slashCommands: boolean;
  readonly runtimeToolUi: boolean;
  readonly questionTool: boolean;
}

export interface RuntimeCompatibilityProfile {
  readonly id: RuntimeCompatibility;
  /** The command used only when frostpi.pi.executable is not configured. */
  readonly executableFallback?: string;
  /** Whether FrostPi may use Pi settings for its own projections. */
  readonly usesPiSettings: boolean;
  readonly capabilities: RuntimeCapabilities;
  defaultSessionRoot(): string;
}

const PI_PROFILE: RuntimeCompatibilityProfile = {
  id: "pi",
  usesPiSettings: true,
  capabilities: {
    sessionTree: true,
    fork: true,
    slashCommands: true,
    runtimeToolUi: false,
    questionTool: true,
  },
  defaultSessionRoot: () => join(homedir(), ".pi", "agent", "sessions"),
};

const OH_MY_PI_PROFILE: RuntimeCompatibilityProfile = {
  id: "oh-my-pi",
  executableFallback: process.platform === "win32" ? "omp.exe" : "omp",
  usesPiSettings: false,
  capabilities: {
    sessionTree: false,
    fork: false,
    slashCommands: false,
    runtimeToolUi: false,
    questionTool: true,
  },
  defaultSessionRoot: () => join(homedir(), ".omp", "agent", "sessions"),
};

/**
 * Return the small, FrostPi-owned compatibility contract for a configured value.
 * Unknown values intentionally fail open to Pi's existing behavior.
 */
export function runtimeCompatibilityProfile(value: string | undefined): RuntimeCompatibilityProfile {
  return value === "oh-my-pi" ? OH_MY_PI_PROFILE : PI_PROFILE;
}

export function isRuntimeCompatibility(value: unknown): value is RuntimeCompatibility {
  return value === "pi" || value === "oh-my-pi";
}
