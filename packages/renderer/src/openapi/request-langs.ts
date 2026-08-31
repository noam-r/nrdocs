/** Canonical request-example language key (tabs are languages only). */
export function canonicalizeRequestLang(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (l === 'curl' || l === 'bash' || l === 'shell' || l === 'sh') return 'curl';
  if (l === 'js' || l === 'javascript') return 'javascript';
  if (l === 'http') return 'http';
  return l;
}

export function requestLangLabel(key: string): string {
  switch (key) {
    case 'curl':
      return 'cURL';
    case 'javascript':
      return 'JavaScript';
    case 'http':
      return 'HTTP';
    default:
      return key;
  }
}

export function requestHighlightLang(key: string, sampleLang?: string): string {
  if (key === 'curl') return 'bash';
  if (key === 'javascript') return 'javascript';
  if (key === 'http') return 'http';
  return sampleLang ?? key;
}
