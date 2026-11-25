import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteCharBackward, deleteCharForward, history, redo, undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import { formatPromptReference } from "$shared/files/promptReferences";
import { referenceChips } from "$ui/features/composer/referenceChips";

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) { view.destroy(); view.dom.remove(); } });
function editor(text: string, readOnly = false) {
  const compartment = new Compartment();
  const view = new EditorView({ state: EditorState.create({ doc: text, selection: { anchor: text.length },
    extensions: [history(), referenceChips(), compartment.of(EditorState.readOnly.of(readOnly))],
  }), parent: document.body });
  views.push(view);
  return { view, compartment };
}

describe("Composer file reference chips", () => {
  it("shows the file and selected lines, with the entire literal path accessible", () => {
    const path = "observatory/experiments/Quarterly Observatory Instrument Calibration Notes.tex:23-23";
    const text = `Use ${formatPromptReference(path)} and ordinary \`code\``;
    const { view } = editor(text);
    const chip = view.dom.querySelector<HTMLElement>(".cm-file-reference")!;
    expect(chip.title).toBe(path);
    expect(chip.textContent).toBe("Quarterly Observatory Instrument Calibration Notes.tex:23-23");
    expect(chip.querySelector(".file-reference-name")?.textContent).toBe("Quarterly Observatory Instrument Calibration Notes.tex");
    expect(chip.querySelector(".file-reference-lines")?.textContent).toBe(":23-23");
    expect(chip.querySelector("button")?.getAttribute("aria-label")).toBe(`Edit file reference ${path}`);
    expect(view.state.doc.toString()).toBe(text);
    expect(view.dom.querySelectorAll(".cm-file-reference")).toHaveLength(1);
  });

  it("removes only the chosen reference and restores it with undo/redo", () => {
    const first = formatPromptReference("first.md"), second = formatPromptReference("second.md");
    const text = `before ${first} between ${second} after`;
    const { view } = editor(text);
    view.dom.querySelector<HTMLButtonElement>('[aria-label="Remove file reference first.md"]')!.click();
    expect(view.state.doc.toString()).toBe(`before  between ${second} after`);
    expect(view.dom.querySelectorAll(".cm-file-reference")).toHaveLength(1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`before  between ${second} after`);
  });

  it("undoes removing a newly inserted reference without undoing its insertion", () => {
    const text = `before ${formatPromptReference("first.md")} after`;
    const { view } = editor("");
    view.dispatch({ changes: { from: 0, insert: text }, selection: { anchor: text.length } });
    view.dom.querySelector<HTMLButtonElement>(".cm-file-reference-remove")!.click();
    expect(view.state.doc.toString()).toBe("before  after");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });

  it.each(["backspace", "delete"])("supports whole-reference %s and undo", direction => {
    const text = formatPromptReference("src/main.ts");
    const { view } = editor(text);
    view.dispatch({ selection: { anchor: direction === "backspace" ? text.length : 0 } });
    expect((direction === "backspace" ? deleteCharBackward : deleteCharForward)(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("exposes editable source on click and recreates the chip after editing", () => {
    const { view } = editor(formatPromptReference("old file.md"));
    view.dom.querySelector<HTMLButtonElement>(".cm-file-reference-label")!.click();
    expect(view.dom.querySelector(".cm-file-reference")).toBeNull();
    const selection = view.state.selection.main;
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe("old file.md");
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: "new file.md" }, selection: { anchor: 0 } });
    expect(view.dom.querySelector(".cm-file-reference")?.textContent).toBe("new file.md");
  });

  it("preserves raw text through whole-chip selection and keeps HTML inert", () => {
    const text = formatPromptReference("<img src=x onerror=alert(1)>.md");
    const { view } = editor(text);
    expect(view.dom.querySelector(".cm-file-reference img")).toBeNull();
    expect(view.dom.querySelector(".cm-file-reference-label")?.textContent).toBe("<img src=x onerror=alert(1)>.md");
    view.dispatch({ selection: EditorSelection.range(0, text.length) });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(text);
    expect(view.dom.querySelector(".cm-file-reference")).toBeNull();
  });

  it("disables mouse changes during recovery and reenables them afterwards", () => {
    const text = formatPromptReference("src/main.ts");
    const { view, compartment } = editor(text, true);
    const buttons = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-file-reference button")];
    expect(buttons.every(button => button.disabled)).toBe(true);
    buttons.forEach(button => button.click());
    expect(view.state.doc.toString()).toBe(text);
    view.dispatch({ effects: compartment.reconfigure(EditorState.readOnly.of(false)) });
    const remove = view.dom.querySelector<HTMLButtonElement>(".cm-file-reference-remove")!;
    expect(remove.disabled).toBe(false);
    remove.click();
    expect(view.state.doc.toString()).toBe("");
  });
});
