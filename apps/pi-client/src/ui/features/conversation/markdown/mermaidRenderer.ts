import type { MermaidConfig } from "mermaid";

import { sanitizeMermaidSvg } from "./renderMarkdown";

type MermaidApi = {
  initialize(config: MermaidConfig): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

let mermaidPromise: Promise<MermaidApi> | null = null;
let diagramSeq = 0;
let renderChain: Promise<void> = Promise.resolve();
const svgCache = new Map<string, string>();
const SVG_CACHE_LIMIT = 64;

function detectTheme(): "dark" | "default" {
  const kind = document.body?.getAttribute("data-vscode-theme-kind") ?? "";
  if (kind.includes("high-contrast") || kind.includes("dark")) return "dark";
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--vscode-editor-background").trim();
  if (bg.startsWith("#") && bg.length >= 7) {
    const r = Number.parseInt(bg.slice(1, 3), 16);
    const g = Number.parseInt(bg.slice(3, 5), 16);
    const b = Number.parseInt(bg.slice(5, 7), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.45 ? "dark" : "default";
  }
  return "dark";
}

function mermaidScriptUrl(): string {
  // Prefer the webview entry script so paths stay correct even if helpers are chunked.
  const entry = document.querySelector<HTMLScriptElement>("script[src*=\"webview.js\"]");
  if (entry?.src) return new URL("./vendor/mermaid.min.js", entry.src).href;
  return new URL("./vendor/mermaid.min.js", import.meta.url).href;
}

/**
 * Load the prebuilt IIFE bundle via <script>, not Vite dynamic import().
 * Vite's mermaid code-split graph imports helpers back from webview.js; that
 * cycle hangs under the VS Code Webview module loader.
 */
function loadMermaid(): Promise<MermaidApi> {
  if (window.mermaid) return Promise.resolve(window.mermaid);

  mermaidPromise ??= new Promise<MermaidApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-frost-mermaid]");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.mermaid) resolve(window.mermaid);
        else reject(new Error("Mermaid loaded without global export"));
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load Mermaid script")));
      return;
    }

    const script = document.createElement("script");
    script.dataset.frostMermaid = "1";
    script.src = mermaidScriptUrl();
    script.async = true;

    // Match CSP script-src 'nonce-...' from the boot script.
    const boot = document.querySelector<HTMLScriptElement>("script[nonce]");
    const nonce = boot?.nonce || boot?.getAttribute("nonce");
    if (nonce) script.setAttribute("nonce", nonce);

    script.onload = () => {
      if (!window.mermaid) {
        reject(new Error("Mermaid loaded without global export"));
        return;
      }
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: detectTheme(),
        fontFamily: "var(--font-ui, sans-serif)",
      });
      resolve(window.mermaid);
    };
    script.onerror = () => reject(new Error(`Failed to load Mermaid script: ${script.src}`));
    document.head.appendChild(script);
  });

  return mermaidPromise;
}

function nextDiagramId(): string {
  diagramSeq += 1;
  return `frost-mermaid-${diagramSeq}-${Math.random().toString(36).slice(2, 9)}`;
}

function cacheSvg(source: string, svg: string): void {
  if (svgCache.size >= SVG_CACHE_LIMIT) {
    const first = svgCache.keys().next().value;
    if (first !== undefined) svgCache.delete(first);
  }
  svgCache.set(source, svg);
}

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const run = renderChain.then(task, task);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getCachedMermaidSvg(source: string): string | undefined {
  return svgCache.get(source);
}

export async function renderMermaidSvg(source: string): Promise<string> {
  const cached = svgCache.get(source);
  if (cached !== undefined) return cached;

  return enqueueRender(async () => {
    const again = svgCache.get(source);
    if (again !== undefined) return again;

    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(nextDiagramId(), source);
    const cleaned = sanitizeMermaidSvg(svg);
    if (!cleaned) throw new Error("Diagram SVG failed sanitization");
    cacheSvg(source, cleaned);
    return cleaned;
  });
}
