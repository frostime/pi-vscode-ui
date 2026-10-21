export function redactError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactDiagnosticText(text).slice(0, 12_000);
}

export function redactDiagnosticText(text: string): string {
  return text
    .replace(/([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))=([^\s]+)/gi, "$1=<redacted>")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1<redacted>")
    .replace(/\b(https?|socks5h?|socks4a?):\/\/([^\s/@:]+):([^\s/@]+)@/gi, "$1://<credentials>@");
}
