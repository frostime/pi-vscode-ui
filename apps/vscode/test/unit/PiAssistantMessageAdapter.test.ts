import { describe, it } from "vitest";

describe("Pi assistant message version adaptation", () => {
  // pi-084-message-streaming::shape — these cases are the adapter's public behavior contract.
  it.todo("uses a Pi 0.83 cumulative message without appending its delta again");
  it.todo("assembles interleaved Pi 0.84 text and thinking parts by contentIndex");
  it.todo("lets text_end and thinking_end replace temporary accumulated content");
  it.todo("keeps one preparing tool while raw arguments grow and then binds the real tool");
  it.todo("keeps multiple tool content indexes independent");
  it.todo("lets message_end replace the temporary message and close adapter state");
  it.todo("publishes a valid message_end even when no message_start was observed");
  it.todo("ignores malformed or out-of-order deltas without corrupting valid parts");
  it.todo("does not carry partial content across reset or a replacement message_start");
});
