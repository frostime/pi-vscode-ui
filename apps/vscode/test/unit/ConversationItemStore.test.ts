/**
 * Pass 1 test contract. Keep these tests behavior-oriented and assert through
 * ConversationItemStore.read(); do not assert private maps or call order.
 *
 * High-value cases for implementation:
 * - Persisted takeover moves every reasoning/response/tool part out of the old
 *   live turn and preserves the adopted live view IDs.
 * - A late live update after persisted takeover is ignored and cannot recreate
 *   the old turn location.
 * - Two persisted entries sharing a timestamp correlation clue remain distinct;
 *   ambiguous live adoption reports conflict before any visible mutation.
 * - A tool result after assistant relocation updates the single tool activity at
 *   the authoritative turn and never resurrects its former location.
 * - Live and persisted compactions with the same firstKeptEntryId become one
 *   item; replay after persisted takeover is idempotent.
 *
 * Skip tests for constructor wiring, trivial append/replace forwarding, and
 * internal map shapes. ConversationProjection integration tests own visual-turn
 * grouping, retry lifecycle, incremental/full convergence, and reload behavior.
 */
