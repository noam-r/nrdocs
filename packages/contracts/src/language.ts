/** BCP 47 language and document direction. */

export type Direction = 'ltr' | 'rtl' | 'auto';

export const DEFAULT_LANGUAGE = 'und';
export const DEFAULT_DIRECTION: Direction = 'auto';

export function parseDirection(value: unknown): Direction | null {
  if (value === undefined || value === null) return DEFAULT_DIRECTION;
  if (value === 'ltr' || value === 'rtl' || value === 'auto') return value;
  return null;
}

/**
 * Canonicalize one BCP 47 language tag via the runtime Intl API.
 * Omitted / null / undefined resolves to `und` without inspecting content or locale.
 */
export function resolveLanguage(value: unknown): string | null {
  if (value === undefined || value === null) return DEFAULT_LANGUAGE;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/,/.test(trimmed)) return null; // lists forbidden
  if (trimmed === 'und') return 'und';
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    if (!canonical) return null;
    return canonical;
  } catch {
    return null;
  }
}

export function assertLanguage(value: unknown): string {
  const lang = resolveLanguage(value);
  if (!lang) throw new Error('invalid language tag');
  return lang;
}

export function assertDirection(value: unknown): Direction {
  const dir = parseDirection(value);
  if (!dir) throw new Error('invalid direction');
  return dir;
}
