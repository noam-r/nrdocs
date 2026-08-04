/** Fixed extension allowlists and MIME mappings. */

export const IMAGE_EXTENSIONS = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
] as const);

export const ATTACHMENT_EXTENSIONS = Object.freeze([
  '.pdf',
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ndjson',
  '.zip',
] as const);

export const FORBIDDEN_WEB_EXTENSIONS = Object.freeze([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.wasm',
  '.svg',
] as const);

export const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/vnd.microsoft.icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.ndjson': 'application/x-ndjson',
  '.zip': 'application/zip',
});

export function normalizeExtension(filename: string): string | null {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  if (i <= 0) return null;
  return base.slice(i).toLowerCase();
}

export function mediaTypeForExtension(ext: string): string | null {
  return EXTENSION_MEDIA_TYPES[ext.toLowerCase()] ?? null;
}

export function isImageExtension(ext: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function isAttachmentExtension(ext: string): boolean {
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function isForbiddenWebExtension(ext: string): boolean {
  return (FORBIDDEN_WEB_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function assertExtensionSetsDisjoint(): void {
  const allowed = new Set<string>([...IMAGE_EXTENSIONS, ...ATTACHMENT_EXTENSIONS]);
  for (const ext of FORBIDDEN_WEB_EXTENSIONS) {
    if (allowed.has(ext)) {
      throw new Error(`extension ${ext} is both allowed and forbidden`);
    }
  }
  for (const ext of allowed) {
    if (!EXTENSION_MEDIA_TYPES[ext]) {
      throw new Error(`allowed extension ${ext} lacks MIME mapping`);
    }
  }
}
