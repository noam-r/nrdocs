/**
 * Safe return path for password forms (09-fixed-reader-and-serving).
 * Invalid input falls back to /<slug>/ and is never reflected in errors.
 */
export function validateSafeReturnPath(raw: string | null | undefined, slug: string): string {
  const fallback = `/${slug}/`;
  if (raw === null || raw === undefined || raw === '') return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  if (new TextEncoder().encode(decoded).byteLength > 2048) return fallback;
  const prefix = `/${slug}/`;
  if (!decoded.startsWith(prefix) && decoded !== `/${slug}`) return fallback;
  if (decoded === `/${slug}`) return fallback;

  if (
    /[\\?\n\r\t\0]/.test(decoded) ||
    decoded.includes('//') ||
    decoded.includes(':') ||
    decoded.includes('#')
  ) {
    return fallback;
  }
  for (const ch of decoded) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x00 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f)) return fallback;
  }

  const hadTrailingSlash = decoded.endsWith('/');
  const parts = decoded.split('/').filter((p) => p.length > 0);
  if (parts[0] !== slug) return fallback;
  if (parts.some((p) => p === '.' || p === '..' || p === '')) return fallback;

  if (parts.length === 1) return fallback;

  const joined = `/${parts.join('/')}`;
  const canonical = hadTrailingSlash ? `${joined}/` : joined;
  if (decoded !== canonical) return fallback;
  return canonical;
}
