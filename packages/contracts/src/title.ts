/** Shared title and display-name normalization. */

function isControl(cp: number): boolean {
  // Unicode General Category Cc: C0 + DEL + C1
  return (cp >= 0x00 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
}

function scalarCount(s: string): number {
  return [...s].length;
}

export type TitleLimits = {
  min: number;
  max: number;
};

export const SITE_TITLE_LIMITS: TitleLimits = { min: 1, max: 160 };
export const DISPLAY_NAME_LIMITS: TitleLimits = { min: 1, max: 80 };

export function normalizeTitle(
  value: unknown,
  limits: TitleLimits = SITE_TITLE_LIMITS,
): string | null {
  if (typeof value !== 'string') return null;
  // Trim Unicode White_Space
  const trimmed = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  const nfc = trimmed.normalize('NFC');
  for (const ch of nfc) {
    if (isControl(ch.codePointAt(0)!)) return null;
  }
  const n = scalarCount(nfc);
  if (n < limits.min || n > limits.max) return null;
  return nfc;
}

export function assertTitle(value: unknown, limits?: TitleLimits): string {
  const t = normalizeTitle(value, limits);
  if (!t) throw new Error('invalid title');
  return t;
}

export function normalizeDisplayName(value: unknown): string | null {
  return normalizeTitle(value, DISPLAY_NAME_LIMITS);
}
