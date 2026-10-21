import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";

const INDENT = "  ";
const LIST_ITEM = /^([ \t]*)([-*])[ \t]+(.*)$/;

interface PromptListItem {
  indentation: string;
  marker: "-" | "*";
  content: string;
  contentStart: number;
}

export const indentPromptWithTab: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;

  const insertions = new Map<number, string>();
  if (state.selection.ranges.some((range) => !range.empty)) {
    for (const range of state.selection.ranges) {
      forEachSelectedLine(range, state, (lineStart) => insertions.set(lineStart, INDENT));
    }
  } else {
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head);
      insertions.set(LIST_ITEM.test(line.text) ? line.from : range.head, INDENT);
    }
  }

  const changes = [...insertions].map(([from, insert]) => ({ from, insert })).sort((left, right) => left.from - right.from);
  const changeSet = state.changes(changes);
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => EditorSelection.range(
      changeSet.mapPos(range.anchor, 1),
      changeSet.mapPos(range.head, 1),
    )),
    state.selection.mainIndex,
  );
  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent: "input.indent" }));
  return true;
};

export const outdentPromptWithShiftTab: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;

  const lineStarts = new Set<number>();
  if (state.selection.ranges.some((range) => !range.empty)) {
    for (const range of state.selection.ranges) {
      forEachSelectedLine(range, state, (lineStart) => lineStarts.add(lineStart));
    }
  } else {
    for (const range of state.selection.ranges) lineStarts.add(state.doc.lineAt(range.head).from);
  }

  const changes = [...lineStarts]
    .map((from) => {
      const indentation = /^(?: {1,2}|\t)/.exec(state.doc.lineAt(from).text)?.[0];
      return indentation ? { from, to: from + indentation.length } : null;
    })
    .filter((change) => change !== null)
    .sort((left, right) => left.from - right.from);
  if (changes.length === 0) return true;

  const changeSet = state.changes(changes);
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => EditorSelection.range(
      changeSet.mapPos(range.anchor, 1),
      changeSet.mapPos(range.head, 1),
    )),
    state.selection.mainIndex,
  );
  dispatch(state.update({ changes: changeSet, selection, scrollIntoView: true, userEvent: "delete.dedent" }));
  return true;
};

export const insertPromptNewline: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.some((range) => !range.empty)) return false;

  const items = state.selection.ranges.map((range) => {
    const line = state.doc.lineAt(range.head);
    const item = parsePromptListItem(line.text, line.from);
    return !item || range.head < item.contentStart ? null : { range, line, ...item };
  });
  if (items.some((item) => item === null)) return false;

  const transaction = state.changeByRange((range) => {
    const item = items.find((candidate) => candidate?.range.eq(range));
    if (!item) return { range };
    if (item.content.trim().length === 0) {
      const cursor = item.line.from + item.indentation.length;
      return {
        changes: { from: cursor, to: item.line.to },
        range: EditorSelection.cursor(cursor),
      };
    }
    const insert = `\n${item.indentation}${item.marker} `;
    return {
      changes: { from: range.head, insert },
      range: EditorSelection.cursor(range.head + insert.length),
    };
  });
  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

function parsePromptListItem(text: string, lineStart: number): PromptListItem | null {
  const match = LIST_ITEM.exec(text);
  const indentation = match?.[1];
  const marker = match?.[2];
  const content = match?.[3];
  if (indentation === undefined || (marker !== "-" && marker !== "*") || content === undefined) return null;
  return {
    indentation,
    marker,
    content,
    contentStart: lineStart + text.length - content.length,
  };
}

function forEachSelectedLine(
  range: SelectionRange,
  state: EditorState,
  visit: (lineStart: number) => void,
): void {
  for (let position = range.from; position <= range.to;) {
    const line = state.doc.lineAt(position);
    if (range.empty || range.to > line.from) visit(line.from);
    if (line.to >= range.to) break;
    position = line.to + 1;
  }
}
