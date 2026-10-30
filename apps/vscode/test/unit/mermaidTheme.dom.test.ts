import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MermaidBlock from "$ui/features/conversation/markdown/MermaidBlock.svelte";

let activeTheme = "dark";
let waitForLight: Promise<void> | undefined;

beforeEach(() => {
  document.body.dataset.vscodeThemeKind = "vscode-dark";
  window.mermaid = {
    initialize: (config) => { activeTheme = String(config.theme); },
    render: async (_id, source) => {
      const theme = activeTheme;
      if (theme === "default") await waitForLight;
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${theme}: ${source}</text></svg>` };
    },
  };
});
afterEach(() => {
  cleanup();
  delete document.body.dataset.vscodeThemeKind;
  delete window.mermaid;
  waitForLight = undefined;
});

describe("Mermaid color-scheme changes", () => {
  it("updates an already mounted diagram and keeps light and dark SVG caches separate", async () => {
    const view = render(MermaidBlock, { source: "flowchart LR; First-->Second" });
    await waitFor(() => expect(view.container.textContent).toContain("dark: flowchart"));
    document.body.dataset.vscodeThemeKind = "vscode-light";
    await waitFor(() => expect(view.container.textContent).toContain("default: flowchart"));
    document.body.dataset.vscodeThemeKind = "vscode-dark";
    await waitFor(() => expect(view.container.textContent).toContain("dark: flowchart"));
  });

  it("does not replace a cached dark diagram with a late light render", async () => {
    const view = render(MermaidBlock, { source: "flowchart LR; Late-->Result" });
    await waitFor(() => expect(view.container.textContent).toContain("dark: flowchart"));
    let finishLight!: () => void;
    waitForLight = new Promise<void>((resolve) => { finishLight = resolve; });
    document.body.dataset.vscodeThemeKind = "vscode-light";
    await waitFor(() => expect(view.container.textContent).toContain("Rendering diagram"));
    document.body.dataset.vscodeThemeKind = "vscode-dark";
    await waitFor(() => expect(view.container.textContent).toContain("dark: flowchart"));
    finishLight();
    // Await the queued render through the same public renderer before asserting
    // that its completion cannot repaint the now-dark component.
    const { renderMermaidSvg } = await import("$ui/features/conversation/markdown/mermaidRenderer");
    await renderMermaidSvg("flowchart LR; Barrier-->Done", "default");
    await waitFor(() => expect(view.container.textContent).toContain("dark: flowchart"));
  });
});
