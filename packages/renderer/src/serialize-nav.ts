import type { NavigationEntry, NrdocsConfig } from '@nrdocs/contracts';

function dumpScalar(value: string): string {
  // Prefer plain scalars when safe; otherwise JSON-quote.
  if (value === '' || /[:#{}[\],&*?|>!%@`'"]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function dumpNav(entries: NavigationEntry[], indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${pad}- title: ${dumpScalar(e.title)}`);
    if (e.file) lines.push(`${pad}  file: ${dumpScalar(e.file)}`);
    if (e.children && e.children.length > 0) {
      lines.push(`${pad}  children:`);
      lines.push(...dumpNav(e.children, indent + 4));
    }
  }
  return lines;
}

/** Serialize nrdocs.yml preserving known fields. */
export function serializeNrdocsYaml(
  config: Pick<NrdocsConfig, 'title' | 'language' | 'direction' | 'navigation'> & {
    publish?: NrdocsConfig['publish'];
  },
  navigationOverride?: NavigationEntry[],
): string {
  const lines: string[] = [];
  if (config.publish) {
    lines.push('publish:');
    lines.push(`  credential: ${config.publish.credential}`);
    lines.push('');
  }
  lines.push(`title: ${dumpScalar(config.title)}`);
  if (config.language !== 'und') {
    lines.push(`language: ${dumpScalar(config.language)}`);
  }
  if (config.direction !== 'auto') {
    lines.push(`direction: ${config.direction}`);
  }

  const navigation = navigationOverride ?? config.navigation;
  if (navigation === 'auto') {
    lines.push('navigation: auto');
  } else {
    lines.push('navigation:');
    lines.push(...dumpNav(navigation, 2));
  }
  lines.push('');
  return lines.join('\n');
}

export function formatNavigationPreview(entries: NavigationEntry[], indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${pad}- ${e.title}${e.file ? ` (${e.file})` : ''}`);
    if (e.children) lines.push(formatNavigationPreview(e.children, indent + 1));
  }
  return lines.join('\n');
}
