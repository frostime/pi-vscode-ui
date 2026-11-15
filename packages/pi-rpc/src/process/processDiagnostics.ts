/**
 * Introduces the bounded stderr excerpt that a failure message may end with:
 * `<message>. Stderr: <excerpt>`. Consumers that must not repeat third-party output
 * (exported diagnostics) cut the message at this marker.
 */
export const STDERR_EXCERPT_MARKER = "Stderr:";

export class BoundedTextBuffer {
  #value = "";

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("Buffer limit must be a positive integer");
  }

  append(text: string): void {
    this.#value = `${this.#value}${text}`.slice(-this.limit);
  }

  clear(): void {
    this.#value = "";
  }

  toString(): string {
    return this.#value;
  }
}
