/**
 * Read one cookie from a raw Cookie header string.
 * Handles `=` inside the value, optional quoted-string, and percent-decoding when `%` appears.
 */
export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    if (value.includes('%')) {
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep raw */
      }
    }
    return value;
  }
  return null;
}
