import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, vi } from "vitest";

const directory = await mkdtemp(join(tmpdir(), "frostpi-client-settings-"));
beforeEach(() => vi.stubEnv("PI_CODING_AGENT_DIR", directory));
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
