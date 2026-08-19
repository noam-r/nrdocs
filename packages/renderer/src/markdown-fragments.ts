/** Page-local Markdown heading fragments (independent of HTML heading IDs). */

export function markdownFragmentFromHeadingText(text: string): string {
  let s = text.normalize('NFC');
  s = s.replace(/\p{L}/gu, (ch) => {
    const lower = ch.toLocaleLowerCase('en-US');
    return lower;
  });
  s = s.replace(/[^\p{L}\p{N}\s_-]/gu, '');
  s = s.replace(/\s+/gu, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s.length === 0 ? 'section' : s;
}

export function assignHeadingFragments(plainTexts: readonly string[]): string[] {
  const used = new Map<string, number>();
  return plainTexts.map((text) => {
    const base = markdownFragmentFromHeadingText(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    if (count === 0) return base;
    return `${base}-${count + 1}`;
  });
}

export function headingPlainTextFromChildren(
  nodes: ReadonlyArray<{ type: string; value?: string; children?: unknown[] }>,
): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text' && typeof n.value === 'string') out += n.value;
    else if (Array.isArray(n.children)) {
      out += headingPlainTextFromChildren(
        n.children as Array<{ type: string; value?: string; children?: unknown[] }>,
      );
    }
  }
  return out;
}
