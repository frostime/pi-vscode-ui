import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { findPromptReferences, promptReferenceLabel, type PromptReference } from "$shared/files/promptReferences";

class ReferenceChip extends WidgetType {
  constructor(readonly reference: PromptReference, readonly readOnly: boolean) { super(); }

  override eq(other: ReferenceChip): boolean {
    return this.reference.path === other.reference.path && this.readOnly === other.readOnly;
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-file-reference";
    chip.contentEditable = "false";
    chip.title = this.reference.path;
    const icon = chip.appendChild(document.createElement("span"));
    icon.className = "codicon codicon-file";
    icon.setAttribute("aria-hidden", "true");
    const label = chip.appendChild(document.createElement("button"));
    label.type = "button";
    label.className = "cm-file-reference-label file-reference-label";
    const display = promptReferenceLabel(this.reference.path);
    const name = label.appendChild(document.createElement("span"));
    name.className = "file-reference-name";
    name.textContent = display.name;
    if (display.lines) {
      const lines = label.appendChild(document.createElement("span"));
      lines.className = "file-reference-lines";
      lines.textContent = display.lines;
    }
    label.setAttribute("aria-label", `Edit file reference ${this.reference.path}`);
    label.title = `${this.reference.path}\nClick to edit`;
    label.disabled = this.readOnly;
    label.onclick = (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      const from = view.posAtDOM(chip);
      const current = findPromptReferences(view.state.doc.toString()).find(reference => reference.from === from);
      if (!current) return;
      view.dispatch({ selection: { anchor: current.contentFrom, head: current.contentTo }, scrollIntoView: true });
      view.focus();
    };
    const remove = chip.appendChild(document.createElement("button"));
    remove.type = "button";
    remove.className = "cm-file-reference-remove codicon codicon-close";
    remove.setAttribute("aria-label", `Remove file reference ${this.reference.path}`);
    remove.title = "Remove reference";
    remove.disabled = this.readOnly;
    remove.onclick = (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      const from = view.posAtDOM(chip);
      const current = findPromptReferences(view.state.doc.toString()).find(reference => reference.from === from);
      if (!current) return;
      view.dispatch({ changes: { from, to: current.to }, selection: { anchor: from },
        userEvent: "delete", annotations: isolateHistory.of("full") });
      view.focus();
    };
    return chip;
  }
}

function decorations(view: EditorView, references: readonly PromptReference[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const reference of references) {
    // Selecting a reference exposes its source text for ordinary editing/copying.
    if (view.state.selection.ranges.some(range => range.from < reference.to && range.to > reference.from)) continue;
    builder.add(reference.from, reference.to, Decoration.replace({ widget: new ReferenceChip(reference, view.state.readOnly) }));
  }
  return builder.finish();
}

export function referenceChips(): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    references: PromptReference[];
    constructor(view: EditorView) {
      this.references = findPromptReferences(view.state.doc.toString());
      this.decorations = decorations(view, this.references);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) this.references = findPromptReferences(update.state.doc.toString());
      if (update.docChanged || update.selectionSet || update.startState.readOnly !== update.state.readOnly) {
        this.decorations = decorations(update.view, this.references);
      }
    }
  }, { decorations: value => value.decorations });
  return [plugin, EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none)];
}
