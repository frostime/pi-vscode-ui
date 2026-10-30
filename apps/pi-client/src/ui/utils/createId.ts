let sequence = 0;

export function createId(prefix = "id"): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return randomUuid();
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}-${random}`;
}
