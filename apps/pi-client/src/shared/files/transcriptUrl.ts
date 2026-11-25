interface UrlConstructor {
  new (value: string): { protocol: string; username: string; password: string; href: string };
}

/** Generated links support ordinary web destinations without embedded credentials. */
export function transcriptUrl(value: string, URL: UrlConstructor): string | null {
  // eslint-disable-next-line no-control-regex -- Reject characters the URL parser would silently remove.
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
