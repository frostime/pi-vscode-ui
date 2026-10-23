import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import AdmZip from "adm-zip";

import { clearDebuggingEndpoint, connectToApplication, debuggingSwitch } from "./cdp-client.mjs";
import {
  applicationPayload, distributionFiles, distributedArchive, isAllowedPayloadPath,
  productName, productVersion, repositoryRoot, targetArch, targetPlatform,
} from "./packaging.mjs";
import { configuredGuiPath, findOnPath } from "./windows-gui-path.mjs";

const phaseTimeout = 120_000;
const promptMarker = "packaged-ping";
const conversationMarker = "E2E response";

/** Rejected archive content: repository state, sources, development trees and user profiles. */
const forbiddenPayload = [
  [/(^|\/)node_modules\//, "development dependencies"],
  [/(^|\/)test\//, "test sources"],
  [/(^|\/)src\//, "application sources"],
  [/\.ts$/, "TypeScript sources"],
  [/\.map$/, "source maps"],
  [/\.SPEC\.md$/, "module contracts"],
  [/(^|\/)(settings|state)\.json$/, "user profile data"],
  [/\.log$/, "logs"],
  [/(^|\/)\.git\//, "repository metadata"],
  [/\.frostpi-e2e-session/, "synthetic Pi history"],
];

const temporaryRoot = mkdtempSync(join(tmpdir(), "frostpi-desktop-verify-"));
// Spaces prove the distributed app does not depend on an unquoted launcher path.
const workspace = resolve(temporaryRoot, "extracted app with spaces");
const fixtures = resolve(temporaryRoot, "fixtures");
const profile = resolve(fixtures, "FrostPi profile");
const appData = resolve(fixtures, "AppData");
const fixturePi = resolve(fixtures, "fake-pi.cjs");
const releaseFile = resolve(fixtures, "release-stream");
const projects = [resolve(fixtures, "project one"), resolve(fixtures, "project two")];
// The optional real-Pi phase gets its own profile, Pi agent directory and Project,
// so controlled fake history and real sessions never share state.
const realPiPaths = {
  profile: resolve(fixtures, "real Pi profile"),
  appData: resolve(fixtures, "RealPiAppData"),
  localAppData: resolve(fixtures, "RealPiLocalAppData"),
  temp: resolve(fixtures, "real Pi tmp"),
  piAgent: resolve(fixtures, "real Pi agent"),
};
const realPiProject = resolve(fixtures, "real Pi project");
const realPiProbe = resolve(fixtures, "probe.ts");
const realPiRequested = process.argv.includes("--real-pi");
const fakePaths = {
  profile,
  appData,
  localAppData: resolve(fixtures, "LocalAppData"),
  temp: resolve(fixtures, "tmp"),
  piAgent: resolve(fixtures, "pi-agent"),
};
const realPiTimeout = 120_000;
const verified = [];
const childProcesses = new Set();

function pass(check) {
  verified.push(check);
  console.log(`[verify] ${check}`);
}

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 60));
  }
  throw new Error(`Timed out: ${label}${last instanceof Error ? ` (${last.message})` : ""}`);
}

function inspectArchive(archivePath) {
  assert.ok(existsSync(archivePath), `Missing distributed archive: ${archivePath}. Run "pnpm package:desktop" first.`);
  const bytes = readFileSync(archivePath);
  const archiveSha256 = createHash("sha256").update(bytes).digest("hex");
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);
  const roots = [...new Set(entries.map((entry) => entry.split("/")[0]))];
  assert.deepEqual(roots, [productName], `Archive must extract one ${productName} folder, found: ${roots.join(", ")}`);
  for (const entry of entries) {
    for (const [pattern, description] of forbiddenPayload) {
      assert.doesNotMatch(entry, pattern, `Archive must not contain ${description}: ${entry}`);
    }
  }
  return { zip, entries, archiveBytes: bytes.length, archiveSha256 };
}

function inspectDistributionReadme(zip) {
  for (const file of distributionFiles) {
    const entry = zip.getEntry(`${productName}/${file}`);
    assert.ok(entry, `The archive root must contain ${productName}/${file}.`);
    const text = entry.getData().toString("utf8").replace(/^\uFEFF/, "");
    for (const marker of [productVersion(), "FrostPi.exe", "Node", "Pi", "%APPDATA%\\FrostPi", "草稿", "AGPL-3.0-only", "https://github.com/frostime/pi-vscode-ui"]) {
      assert.ok(text.includes(marker), `Distribution ${file} must mention ${marker}.`);
    }
  }
}

function inspectPackagedApplication(applicationRoot) {
  const executable = resolve(applicationRoot, `${productName}.exe`);
  assert.ok(existsSync(executable), `Missing packaged executable: ${executable}`);
  assert.ok(!existsSync(resolve(applicationRoot, "resources/app.asar")), "Packaged app must keep its payload on disk.");

  const payloadRoot = resolve(applicationRoot, "resources/app");
  const payload = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      payload.push(path.slice(payloadRoot.length + 1).replaceAll("\\", "/"));
    }
  };
  walk(payloadRoot);
  for (const path of payload) {
    assert.ok(isAllowedPayloadPath(path), `Unexpected packaged payload file: ${path}`);
  }
  for (const file of applicationPayload.files) {
    assert.ok(payload.includes(file), `Missing packaged payload file: ${file}`);
  }

  const manifest = JSON.parse(readFileSync(resolve(payloadRoot, "package.json"), "utf8"));
  assert.equal(manifest.version, productVersion(), "Packaged manifest must derive from the product version.");
  assert.equal(manifest.main, "dist/main.cjs");
  assert.equal(manifest.type, "module");

  // Attribution must cover the shared table and the Desktop-only runtime dependencies,
  // with the license text those installed packages actually ship.
  const notices = readFileSync(resolve(payloadRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const name of ["@vscode/codicons", "ajv", "fast-uri", "json-schema-traverse", "jsonc-parser", "mermaid", "require-from-string", "svelte"]) {
    assert.ok(notices.includes(`| ${name} |`), `Packaged third-party notices must list ${name}.`);
  }
  for (const name of ["ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse", "jsonc-parser", "require-from-string"]) {
    assert.ok(notices.includes(`### ${name} `), `Packaged third-party notices must include the license text of ${name}.`);
  }
  assert.ok(notices.includes("Permission is hereby granted"), "MIT license text is missing from the packaged notices.");
  assert.ok(notices.includes("Redistribution and use in source and binary forms"), "BSD license text is missing from the packaged notices.");

  for (const artifact of ["dist/main.cjs", "dist/preload.cjs", "dist/pi-extensions/session-tree.js", "dist/pi-extensions/question-tool.js"]) {
    assert.ok(statSync(resolve(payloadRoot, artifact)).size > 0, `Empty packaged artifact: ${artifact}`);
  }
  const sharedBundles = ["dist/main.cjs", "dist/preload.cjs"].map((file) => readFileSync(resolve(payloadRoot, file), "utf8"));
  for (const bundle of sharedBundles) {
    assert.doesNotMatch(bundle, /@frostime\//, "Packaged bundles must not resolve workspace packages at runtime.");
    assert.doesNotMatch(bundle, /require\("\.\.?\.\.?\//, "Packaged bundles must resolve no repository-relative modules.");
  }
  const renderer = resolve(payloadRoot, "dist/renderer");
  assert.ok(existsSync(resolve(payloadRoot, "dist/renderer/vendor/mermaid.min.js")), "Missing packaged Mermaid resource.");
  assert.ok(readdirSync(renderer).some((name) => /^codicon-.*\.ttf$/.test(name)), "Missing packaged Codicons font.");
  assert.ok(readdirSync(renderer).some((name) => /^KaTeX_.*\.woff2$/.test(name)), "Missing packaged math fonts.");
  assert.ok(readdirSync(renderer).some((name) => /^style-.*\.css$/.test(name)), "Missing packaged shared stylesheet.");
  assert.ok(!existsSync(resolve(payloadRoot, "dist/smoke-main.cjs")), "Development smoke bundle must not ship.");
  return { applicationRoot, executable, version: manifest.version };
}

function applicationEnvironment(guiPath, paths = fakePaths) {
  const systemRoot = process.env.SystemRoot;
  return {
    // Desktop-like launch: the configured machine/user PATH, no NODE_OPTIONS,
    // NODE_PATH or ELECTRON_RUN_AS_NODE, and no injected development directories.
    SystemRoot: systemRoot,
    windir: systemRoot,
    SystemDrive: process.env.SystemDrive,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    USERPROFILE: process.env.USERPROFILE,
    NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS,
    TEMP: paths.temp,
    TMP: paths.temp,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    PATH: guiPath,
    FROSTPI_DESKTOP_USER_DATA: paths.profile,
    PI_CODING_AGENT_DIR: paths.piAgent,
  };
}

function launchApplication(application, argumentsList, logName, guiPath, { paths = fakePaths, environment = {} } = {}) {
  clearDebuggingEndpoint([paths.profile, paths.appData]);
  const log = resolve(fixtures, logName);
  const child = spawn(application.executable, [...argumentsList, debuggingSwitch], {
    cwd: application.applicationRoot, env: { ...applicationEnvironment(guiPath, paths), ...environment }, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.add(child);
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  child.once("exit", () => {
    childProcesses.delete(child);
    writeFileSync(log, Buffer.concat(output));
  });
  return child;
}

async function stopApplication(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  await until(() => child.exitCode !== null || child.signalCode !== null, "packaged app exits after termination", 20_000);
}

async function closeWindow(client) {
  await client.evaluate("window.close()");
}

async function waitForExit(child, label) {
  return until(() => child.exitCode !== null || child.signalCode !== null, label, 30_000);
}

function conversationText(client) {
  return client.evaluate("document.querySelector('.client-region')?.innerText ?? ''");
}

/** A saved-session row, matched by its Project cwd rather than by list position. */
function projectRow(directory) {
  return `[...document.querySelectorAll('.pi-row')].find((row) => row.title.startsWith(${JSON.stringify(directory)}))`;
}

function projectRowStatus(directory) {
  return `${projectRow(directory)}?.querySelector('.status-dot')?.getAttribute('aria-label') ?? null`;
}

function activeRowStatus() {
  return "document.querySelector('.pi-row.chosen')?.querySelector('.status-dot')?.getAttribute('aria-label') ?? null";
}

function projectButtons() {
  return `[...document.querySelectorAll('aside button:not(.pi-row):not(.settings-button):not([aria-label])')]`;
}

async function sendPrompt(client, text) {
  await client.typeIntoComposer(text);
  await until(() => client.evaluate(`!document.querySelector('[aria-label="Send to Pi"]').disabled`), "composer accepts the prompt");
  await client.evaluate(`document.querySelector('[aria-label="Send to Pi"]').click()`);
}

async function runFirstSession(client) {
  await until(() => client.evaluate(`document.body.innerText.includes('Start or resume a Pi session')`), "shared empty state");
  pass("shared UI entry renders");

  const isolation = await client.evaluate(`({
    node: typeof window.require,
    process: typeof window.process,
    rawIpc: typeof window.frostpiDesktop?.ipcRenderer,
    bridge: typeof window.frostpiDesktop?.postClientMessage,
  })`);
  assert.deepEqual(isolation, { node: "undefined", process: "undefined", rawIpc: "undefined", bridge: "function" });
  pass("renderer has no Node, raw IPC or preload bypass");

  const fonts = await client.evaluate(`document.fonts.ready.then(() => ({
    codicon: [...document.fonts].filter((font) => /codicon/i.test(font.family)).map((font) => font.status),
    usable: document.fonts.check('16px codicon'),
    glyph: [...document.querySelectorAll('span.codicon')].some((element) => {
      const content = getComputedStyle(element, '::before').content;
      return typeof content === 'string' && content !== 'none' && content !== 'normal' && content !== 'inherit';
    }),
  }))`);
  assert.ok(fonts.codicon.length > 0, "Packaged Codicons font face is not registered.");
  assert.ok(fonts.usable, "Packaged Codicons font is not usable for glyphs.");
  assert.ok(fonts.glyph, "Packaged icon glyphs did not render.");
  pass("Codicons font and icon glyphs load from the extracted app");

  await client.evaluate("document.querySelector('.onboarding-actions .primary').click()");
  await until(() => client.evaluate(`${projectRowStatus(projects[0])} === 'ready'`), "first Pi ready in project one");
  assert.equal(await client.evaluate("document.querySelectorAll('.pi-row').length"), 1);
  pass("controlled Pi starts in the first Project");

  await sendPrompt(client, promptMarker);
  await until(async () => (await conversationText(client)).includes(conversationMarker), "first response rendered");
  pass("prompt and response travel through the shared conversation UI");

  await sendPrompt(client, "mermaid");
  await until(() => client.evaluate("Boolean(document.querySelector('.mermaid-host svg'))"), "packaged Mermaid renders");
  const diagram = String(await client.evaluate("document.querySelector('.mermaid-host svg').textContent"));
  assert.match(diagram, /Shared/);
  assert.match(diagram, /Desktop/);
  pass("Mermaid renders from the packaged vendor resource");

  await client.evaluate("document.querySelector('.settings-button').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('#settings-title'))"), "Desktop settings panel");
  const editorFont = await client.evaluate("document.documentElement.style.getPropertyValue('--vscode-editor-font-family')");
  assert.ok(String(editorFont).length > 0, "Settings entry did not apply the shared editor font variable.");
  await client.evaluate("document.querySelector('dialog[aria-labelledby=\"settings-title\"] header button').click()");
  await until(() => client.evaluate("!document.querySelector('#settings-title')"), "settings panel closes");
  pass("Desktop settings entry opens the packaged renderer panel");
}

async function runSecondProject(client) {
  const secondProject = `${projectButtons()}[1]`;
  await client.evaluate(`${secondProject}.click()`);
  await until(() => client.evaluate(`${secondProject}.classList.contains('chosen')`), "Project two selection");
  await client.evaluate("document.querySelector('[aria-label=\"New or resume session\"]').click()");
  await until(() => client.evaluate("Boolean(document.querySelector('.launcher-create'))"), "New menu");
  await client.evaluate("document.querySelector('.launcher-create').click()");
  await until(() => client.evaluate(`${projectRowStatus(projects[1])} === 'ready'`), "second Pi ready in project two");
  assert.equal(await client.evaluate("document.querySelectorAll('.pi-row').length"), 2);
  pass("two unrelated Projects host independent Pi sessions");
}

async function stopStreamingSession(client) {
  await sendPrompt(client, "stream-084");
  await until(() => client.evaluate(`${projectRowStatus(projects[1])} === 'running'`), "second Pi starts streaming");
  await until(() => client.evaluate("Boolean(document.querySelector('.stop-button'))"), "composer offers Stop");
  await client.evaluate("document.querySelector('.stop-button').click()");
  await until(() => client.evaluate(`${projectRowStatus(projects[1])} !== 'running'`), "Stop ends the streaming Pi");
  assert.equal(await client.evaluate(projectRowStatus(projects[0])), "ready", "Stop must not cancel work in the other session.");
  writeFileSync(releaseFile, "finish");
  pass("Stop cancels only the targeted turn");
}

function assertProfileState(seededSettings) {
  const settingsPath = resolve(profile, "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), seededSettings, "The app must not rewrite its own settings on close.");
  const state = JSON.parse(readFileSync(resolve(profile, "state.json"), "utf8"));
  assert.equal(state.projects.length, 2, "Project metadata was not persisted in the FrostPi profile.");
  const sessions = state.workspaceState["frostpi.sessions.v1"];
  assert.equal(sessions.sessions.length, 2);
  const selectedSession = sessions.sessions.find((session) => session.id === sessions.activeSessionId);
  assert.equal(resolve(selectedSession.cwd), resolve(projects[0]), "Close must save the foreground Pi as the restart selection.");
  assert.ok(!existsSync(resolve(workspace, productName, "settings.json")), "Profile data must not be written beside the executable.");
  assert.ok(!existsSync(resolve(workspace, productName, "state.json")), "State must not be written beside the executable.");
  pass("profile settings and Project/session state persist under FROSTPI_DESKTOP_USER_DATA");
}

async function runRestoredSession(client, expectedProjects) {
  await until(() => client.evaluate(`${projectButtons()}.length === 2`), "restored Projects", 20_000);
  const restored = await client.evaluate(`${projectButtons()}.map((button) => button.title)`);
  assert.deepEqual(restored.map((path) => resolve(path)), expectedProjects.map((path) => resolve(path)));
  await until(() => client.evaluate("document.querySelectorAll('.pi-row').length === 2"), "restored saved sessions");
  pass("reopen restores both Projects and saved-session entries");

  await until(() => client.evaluate(`${projectRowStatus(expectedProjects[0])} === 'ready'`), "selected saved Pi resumes", 30_000);
  const restoredText = await until(async () => {
    const text = await conversationText(client);
    return text.includes(conversationMarker) && text.includes(promptMarker) ? text : undefined;
  }, "restored history reaches the shared conversation", 30_000);
  assert.equal((restoredText.match(new RegExp(promptMarker, "g")) ?? []).length, 1, "Reopen must not replay prompts.");
  pass("selected saved Pi reloads its Pi-owned history without prompt replay");
}

async function phaseOne(application, seededSettings, guiPath) {
  const child = launchApplication(application, projects, "electron-first.log", guiPath);
  const deadline = Date.now() + phaseTimeout;
  let client;
  try {
    client = await connectToApplication({ searchRoots: [profile, appData], deadline });
    await runFirstSession(client);
    await runSecondProject(client);
    await stopStreamingSession(client);
    // The newest session would be the saved selection; choose the first Pi so reopen resumes it.
    await client.evaluate(`${projectRow(projects[0])}.click()`);
    await until(() => client.evaluate(`${projectRow(projects[0])}.classList.contains('chosen')`), "first Pi becomes the saved selection");
    await closeWindow(client);
    await waitForExit(child, "packaged app closes normally");
    assertProfileState(seededSettings);
  } finally {
    client?.close();
    await stopApplication(child);
  }
}

async function phaseTwo(application, guiPath) {
  // No directory arguments: Projects and sessions must come from the stored profile.
  const child = launchApplication(application, [], "electron-second.log", guiPath);
  const deadline = Date.now() + phaseTimeout;
  let client;
  try {
    client = await connectToApplication({ searchRoots: [profile, appData], deadline });
    await runRestoredSession(client, projects);
    await closeWindow(client);
    await waitForExit(child, "reopened packaged app closes normally");
  } finally {
    client?.close();
    await stopApplication(child);
  }
}


/**
 * The real-Pi phase uses a temporary extension and an isolated agent directory.
 * The command is handled before model/auth checks, so no credentials or model
 * request are involved. PI_OFFLINE disables automatic activity such as model
 * catalog refresh; it is not a firewall against explicit model calls.
 */
function prepareRealPiFixtures() {
  for (const directory of [realPiPaths.profile, realPiPaths.appData, realPiPaths.localAppData, realPiPaths.temp, realPiPaths.piAgent, realPiProject]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(realPiProbe, `export default function (pi) {
  pi.registerCommand("package-check", {
    handler: async (_args, ctx) => {
      const ok = await ctx.ui.confirm("Package verification", "Confirm isolated SDK verification", { timeout: 10000 });
      pi.sendMessage({ customType: "package-check", content: ok ? "FROSTPI_REAL_RPC_OK" : "FROSTPI_REAL_RPC_CANCELLED", display: true });
    },
  });
}
`);
  const settings = {
    // No frostpi.pi.executable: the default Pi discovery from the desktop PATH is under test.
    "frostpi.pi.arguments": [
      "--model", "openai/gpt-4o",
      "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      "-e", realPiProbe,
    ],
  };
  writeFileSync(resolve(realPiPaths.profile, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Reconstructs the PATH a normal desktop start receives and proves the packaged
 * app's own prerequisites are discoverable there. Nothing is injected: a missing
 * Node or Pi is reported instead of silently borrowing the development terminal.
 */
function inspectPrerequisites() {
  const guiPath = configuredGuiPath();
  const extensions = process.env.PATHEXT || undefined;
  for (const command of ["node", "pi"]) {
    assert.ok(findOnPath(guiPath.value, command, extensions),
      `"${command}" is not discoverable from the configured Windows machine/user PATH; the desktop app needs it on the normal desktop PATH.`);
  }
  const node = probePrerequisites(guiPath.value, "node", ["--version"], true);
  const pi = probePrerequisites(guiPath.value, process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pi --version"], false);
  if (pi.version === undefined) console.warn(`[verify] warning: pi --version did not report a version (${pi.detail}).`);
  pass(`Node ${node.version} and Pi ${pi.version ?? "?"} are discoverable from the configured desktop PATH`);
  return { guiPath, node, pi };
}

function probePrerequisites(guiPath, command, argumentsList, required) {
  const result = spawnSync(command, argumentsList, {
    env: applicationEnvironment(guiPath, fakePaths), cwd: resolve(fixtures, "tmp"), encoding: "utf8", timeout: 60_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const version = result.status === 0 ? output.split(/\r?\n/)[0].slice(0, 80) : undefined;
  if (version === undefined) {
    const detail = `exit ${result.status ?? "unknown"}${output ? `: ${output.slice(0, 200)}` : ""}`;
    if (required) throw new Error(`"${command} ${argumentsList.at(-1)}" failed from the configured desktop PATH (${detail}).`);
    return { discovered: true, detail };
  }
  return { discovered: true, version };
}

/**
 * The registry briefly refuses a second creation while the previous start is
 * still settling, so the same GUI path is retried instead of reaching into the
 * host. The session launcher closes itself after a click, so each retry reopens it.
 */
async function createTemporarySession(client) {
  const deadline = Date.now() + realPiTimeout;
  while (Date.now() < deadline) {
    if (!await client.evaluate("Boolean(document.querySelector('.launcher-create'))")) {
      await client.evaluate("document.querySelector('[aria-label=\"New or resume session\"]').click()");
      await until(() => client.evaluate("Boolean(document.querySelector('.launcher-expand'))"), "session launcher variants", 10_000);
    }
    await client.evaluate("document.querySelector('.launcher-expand').click()");
    await until(() => client.evaluate("[...document.querySelectorAll('.launcher-variants button')].some((button) => button.textContent.includes('New temporary session'))"), "temporary session entry", 10_000);
    await client.evaluate("[...document.querySelectorAll('.launcher-variants button')].find((button) => button.textContent.includes('New temporary session')).click()");
    const active = await until(
      () => client.evaluate("Boolean(document.querySelector('.ephemeral-badge'))"),
      "temporary session is active", 3_000,
    ).catch(() => false);
    if (active) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("The GUI did not open a temporary session.");
}

/** Installed Pi command/UI only; controlled fake phases cover durable history and streaming Stop. */
async function phaseRealPi(application, guiPath) {
  const environment = { PI_OFFLINE: "1" };
  const child = launchApplication(application, [realPiProject], "electron-real-pi.log", guiPath, {
    paths: realPiPaths, environment,
  });
  const deadline = Date.now() + phaseTimeout;
  let client;
  try {
    client = await connectToApplication({ searchRoots: [realPiPaths.profile, realPiPaths.appData], deadline });
    // The empty workspace offers a normal New only; it is the GUI entry to the launcher.
    await until(() => client.evaluate("Boolean(document.querySelector('.onboarding-actions .primary'))"), "real Pi onboarding New", realPiTimeout);
    await client.evaluate("document.querySelector('.onboarding-actions .primary').click()");
    await until(() => client.evaluate(`${projectRowStatus(realPiProject)} === 'ready'`), "real Pi starts in the isolated profile", realPiTimeout);
    pass("packaged app starts the installed Pi from the configured desktop PATH");

    await createTemporarySession(client);
    await until(() => client.evaluate(`${activeRowStatus()} === 'ready'`), "temporary real Pi session ready", realPiTimeout);

    await sendPrompt(client, "/package-check");
    await until(() => client.evaluate("Boolean(document.querySelector('section.extension-ui-card'))"), "real Pi confirmation reaches the GUI", realPiTimeout);
    const confirmText = String(await client.evaluate("document.querySelector('section.extension-ui-card').innerText"));
    assert.match(confirmText, /Package verification/);
    assert.match(confirmText, /Confirm isolated SDK verification/);
    await client.evaluate("document.querySelector('.extension-ui-actions .primary').click()");
    pass("real Pi command blocks on a real confirmation and resolves through the GUI");

    await until(() => client.evaluate("[...document.querySelectorAll('.custom-message-type')].some((element) => element.textContent === 'package-check')"), "custom message block", realPiTimeout);
    await client.evaluate("[...document.querySelectorAll('.custom-message-trigger')].find((button) => button.textContent.includes('package-check')).click()");
    const body = await until(
      () => client.evaluate("[...document.querySelectorAll('.custom-message-content')].map((element) => element.innerText).find((value) => value.includes('FROSTPI_REAL_RPC_')) ?? ''"),
      "custom message body renders", realPiTimeout,
    );
    assert.match(String(body), /FROSTPI_REAL_RPC_OK/);
    pass("custom message body from the real Pi extension renders in the shared conversation");

    await closeWindow(client);
    await waitForExit(child, "real Pi packaged app closes normally");
    const saved = JSON.parse(readFileSync(resolve(realPiPaths.profile, "state.json"), "utf8"));
    assert.deepEqual(saved.workspaceState["frostpi.sessions.v1"].sessions, []);
    assert.equal(saved.workspaceState["frostpi.sessions.v1"].activeSessionId, null);
    pass("GUI creates an ephemeral real Pi session that is never saved");
    return { ephemeralSession: true, automaticNetworkActivityDisabled: environment.PI_OFFLINE === "1" };
  } finally {
    client?.close();
    await stopApplication(child);
  }
}

function prepareFixtures() {
  mkdirSync(workspace, { recursive: true });
  for (const directory of [profile, appData, resolve(fixtures, "LocalAppData"), resolve(fixtures, "pi-agent"), resolve(fixtures, "tmp"), ...projects]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(resolve(repositoryRoot, "apps/pi-client/test/fixtures/fake-pi.cjs"), fixturePi);
  const settings = {
    "frostpi.pi.executable": fixturePi,
    "frostpi.pi.arguments": ["--persist-session-fixture", "--stream-084-release", releaseFile],
  };
  writeFileSync(resolve(profile, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

async function main() {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
  const archive = distributedArchive();
  const { zip, entries, archiveBytes, archiveSha256 } = inspectArchive(archive);
  inspectDistributionReadme(zip);
  mkdirSync(workspace, { recursive: true });
  zip.extractAllTo(workspace, true);
  const application = inspectPackagedApplication(resolve(workspace, productName));
  pass(`archive ${targetPlatform}-${targetArch} contains ${entries.length} packaged files and a whitelisted payload`);
  pass("archive root README.txt documents launch, prerequisites, data location and licence");

  const seededSettings = prepareFixtures();
  assert.ok(existsSync(application.executable), "Extraction did not produce the packaged executable.");
  pass("archive extracts outside the repository into a path containing spaces");

  const { guiPath, node, pi } = inspectPrerequisites();
  await phaseOne(application, seededSettings, guiPath.value);
  await phaseTwo(application, guiPath.value);
  let realPiObservations;
  if (realPiRequested) {
    prepareRealPiFixtures();
    realPiObservations = await phaseRealPi(application, guiPath.value);
  }

  const result = {
    ok: true,
    archive,
    archiveBytes,
    archiveSha256,
    version: application.version,
    executable: application.executable,
    verified,
    environment: {
      // Only the source of the desktop PATH is recorded, never its entries.
      pathSource: guiPath.sources.join(" + "),
      pathEntries: guiPath.entryCount,
      unresolvedPathReferences: guiPath.unresolvedReferences,
      launchPathMatchesConfiguration: applicationEnvironment(guiPath.value, fakePaths).PATH === guiPath.value,
      node,
      pi,
      ...(realPiRequested ? {
        realPi: {
          version: pi.version,
          credentialSetup: "isolated agent directory and minimal environment; no credentials configured",
          ...realPiObservations,
          exercisedInput: "extension command handled before model/auth checks; no model-completion scenario",
          sessionFilePersistence: "not claimed; this phase exercises the runtime and UI, not history files",
        },
      } : {}),
      profile,
      isolated: ["FROSTPI_DESKTOP_USER_DATA", "PI_CODING_AGENT_DIR", "APPDATA", "LOCALAPPDATA", "TEMP"],
    },
    scope: "Artifact-specific checks: controlled Pi covers conversation/Stop/history; optional real Pi covers command/confirmation/custom display only. No model-completion scenario, signing or public release is exercised.",
  };
  writeFileSync(resolve(fixtures, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[verify] success: ${verified.length} checks`);
  console.log(`[verify] artifacts: ${fixtures}`);
}

// Redirected output is asynchronous, so drain it before the explicit exit code.
async function exit(code) {
  await new Promise((resolve) => process.stdout.write("", resolve));
  await new Promise((resolve) => process.stderr.write("", resolve));
  process.exit(code);
}

main().then(
  () => exit(0),
  async (error) => {
    for (const child of childProcesses) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    const message = error instanceof Error ? error.message : "Packaged verification failed.";
    console.error(`[verify] failed: ${message}`);
    if (error instanceof Error) console.error(error.stack);
    try {
      mkdirSync(fixtures, { recursive: true });
      writeFileSync(resolve(fixtures, "result.json"), `${JSON.stringify({ ok: false, error: message, verified }, null, 2)}\n`);
      console.error(`[verify] artifacts: ${fixtures}`);
    } catch {
      // Keep the original failure visible when the artifact directory is unusable.
    }
    await exit(1);
  },
);
