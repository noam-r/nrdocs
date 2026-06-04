/**
 * Content hardening tests for Worker-side validation.
 * Tests archive validation and MIME type handling.
 */

import { describe, it, expect } from 'vitest';
import { extractArtifact } from '../archive.js';
import { getMimeType, getSecurityHeaders } from '../mime.js';

/**
 * Helper to create a minimal valid tar.gz archive for testing.
 * Creates a gzipped tar with the given files.
 */
async function createTestArchive(
  files: Array<{ name: string; content: string }>,
): Promise<ArrayBuffer> {
  // Build a tar archive manually
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const contentBytes = encoder.encode(file.content);
    const header = createTarHeader(file.name, contentBytes.length);
    blocks.push(header);

    // Content padded to 512-byte boundary
    const paddedSize = Math.ceil(contentBytes.length / 512) * 512;
    const paddedContent = new Uint8Array(paddedSize);
    paddedContent.set(contentBytes);
    blocks.push(paddedContent);
  }

  // End-of-archive: two 512-byte zero blocks
  blocks.push(new Uint8Array(1024));

  // Concatenate all blocks
  let totalLen = 0;
  for (const b of blocks) totalLen += b.length;
  const tar = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of blocks) {
    tar.set(b, offset);
    offset += b.length;
  }

  // Gzip compress
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(tar);
  writer.close();

  const chunks: Uint8Array[] = [];
  let len = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    len += value.length;
  }

  const result = new Uint8Array(len);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result.buffer;
}

/**
 * Creates a 512-byte tar header for a regular file.
 */
function createTarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  // Name (bytes 0-99)
  const nameBytes = encoder.encode(name);
  header.set(nameBytes.slice(0, 100), 0);

  // Mode (bytes 100-107): 0644
  const mode = encoder.encode('0000644\0');
  header.set(mode, 100);

  // UID (bytes 108-115)
  const uid = encoder.encode('0001000\0');
  header.set(uid, 108);

  // GID (bytes 116-123)
  const gid = encoder.encode('0001000\0');
  header.set(gid, 116);

  // Size (bytes 124-135): octal
  const sizeStr = size.toString(8).padStart(11, '0') + '\0';
  header.set(encoder.encode(sizeStr), 124);

  // Mtime (bytes 136-147)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0';
  header.set(encoder.encode(mtime), 136);

  // Type flag (byte 156): '0' = regular file
  header[156] = '0'.charCodeAt(0);

  // Checksum (bytes 148-155): initially spaces for calculation
  header.set(encoder.encode('        '), 148);

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i]!;
  }
  const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.set(encoder.encode(checksumStr), 148);

  return header;
}

describe('Archive validation', () => {
  it('valid archive with manifest → accepted', async () => {
    const manifest = JSON.stringify({ version: 1, pages: [] });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'index.html', content: '<h1>Hello</h1>' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.fileCount).toBe(2);
      expect(result.result.manifest).toEqual({ version: 1, pages: [] });
    }
  });

  it('archive without manifest → rejected', async () => {
    const archive = await createTestArchive([
      { name: 'index.html', content: '<h1>Hello</h1>' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_MANIFEST');
    }
  });

  it('archive with path traversal → rejected', async () => {
    const manifest = JSON.stringify({ version: 1 });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: '../escape.html', content: 'evil' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PATH_TRAVERSAL');
    }
  });

  it('archive with .js files → rejected', async () => {
    const manifest = JSON.stringify({ version: 1 });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'script.js', content: 'alert(1)' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REJECTED_EXTENSION');
    }
  });

  it('archive with whitelisted .yaml → accepted', async () => {
    const manifest = JSON.stringify({ version: 1, pages: [] });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'index.html', content: '<h1>Hi</h1>' },
      { name: 'schemas/openapi.yaml', content: 'openapi: 3.0.0' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(true);
  });

  it('archive with unlisted .zip → rejected without allowUnlisted', async () => {
    const manifest = JSON.stringify({ version: 1, pages: [] });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'index.html', content: '<h1>Hi</h1>' },
      { name: 'bundle.zip', content: 'PK' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTENSION_NOT_PERMITTED');
    }
  });

  it('archive with unlisted .zip → accepted when allowUnlisted', async () => {
    const manifest = JSON.stringify({ version: 1, pages: [] });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'index.html', content: '<h1>Hi</h1>' },
      { name: 'bundle.zip', content: 'PK' },
    ]);

    const result = await extractArtifact(archive, undefined, { allowUnlisted: true });
    expect(result.ok).toBe(true);
  });

  it('archive with platform _nrdocs runtime .js → accepted', async () => {
    const manifest = JSON.stringify({ version: 1, pages: [] });
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'index.html', content: '<h1>Hi</h1>' },
      { name: '_nrdocs/mermaid.min.js', content: 'globalThis.mermaid={};' },
    ]);

    const result = await extractArtifact(archive);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.result.files.map((f) => f.path);
      expect(paths).toContain('_nrdocs/mermaid.min.js');
    }
  });

  it('archive exceeding file count → rejected', async () => {
    const manifest = JSON.stringify({ version: 1 });
    const files = [{ name: 'nrdocs-manifest.json', content: manifest }];
    // Add files up to the limit
    for (let i = 0; i < 5; i++) {
      files.push({ name: `page${i}.html`, content: `<p>${i}</p>` });
    }

    const archive = await createTestArchive(files);
    // Use a very low limit
    const result = await extractArtifact(archive, { maxFileCount: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FILE_COUNT_EXCEEDED');
    }
  });

  it('archive exceeding total size → rejected', async () => {
    const manifest = JSON.stringify({ version: 1 });
    const largeContent = 'x'.repeat(1000);
    const archive = await createTestArchive([
      { name: 'nrdocs-manifest.json', content: manifest },
      { name: 'big.html', content: largeContent },
    ]);

    // Use a very low size limit
    const result = await extractArtifact(archive, { maxTotalSize: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOTAL_SIZE_EXCEEDED');
    }
  });
});

describe('MIME type handling', () => {
  it('returns correct MIME types for all supported extensions', () => {
    expect(getMimeType('page.html')).toBe('text/html; charset=utf-8');
    expect(getMimeType('style.css')).toBe('text/css; charset=utf-8');
    expect(getMimeType('data.json')).toBe('application/json; charset=utf-8');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('image.jpg')).toBe('image/jpeg');
    expect(getMimeType('pic.jpeg')).toBe('image/jpeg');
    expect(getMimeType('anim.gif')).toBe('image/gif');
    expect(getMimeType('modern.webp')).toBe('image/webp');
    expect(getMimeType('favicon.ico')).toBe('image/x-icon');
    expect(getMimeType('readme.txt')).toBe('text/plain; charset=utf-8');
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
  });

  it('returns null for unknown extensions', () => {
    expect(getMimeType('file.exe')).toBeNull();
    expect(getMimeType('app.py')).toBeNull();
    expect(getMimeType('noext')).toBeNull();
  });

  it('returns MIME type for .js runtime files', () => {
    expect(getMimeType('_nrdocs/mermaid.min.js')).toBe('text/javascript; charset=utf-8');
    expect(getMimeType('script.js')).toBe('text/javascript; charset=utf-8');
  });

  it('SVG gets extra CSP headers', () => {
    const headers = getSecurityHeaders('image.svg');
    expect(headers['Content-Security-Policy']).toContain("script-src 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('all responses get nosniff header', () => {
    expect(getSecurityHeaders('page.html')['X-Content-Type-Options']).toBe('nosniff');
    expect(getSecurityHeaders('style.css')['X-Content-Type-Options']).toBe('nosniff');
    expect(getSecurityHeaders('data.json')['X-Content-Type-Options']).toBe('nosniff');
    expect(getSecurityHeaders('photo.png')['X-Content-Type-Options']).toBe('nosniff');
  });

  it('non-SVG files do not get CSP headers', () => {
    expect(getSecurityHeaders('page.html')['Content-Security-Policy']).toBeUndefined();
    expect(getSecurityHeaders('style.css')['Content-Security-Policy']).toBeUndefined();
    expect(getSecurityHeaders('photo.png')['Content-Security-Policy']).toBeUndefined();
  });

  it('handles paths with directories', () => {
    expect(getMimeType('assets/style.css')).toBe('text/css; charset=utf-8');
    expect(getMimeType('deep/nested/page.html')).toBe('text/html; charset=utf-8');
  });

  it('handles case-insensitive extensions', () => {
    expect(getMimeType('FILE.HTML')).toBe('text/html; charset=utf-8');
    expect(getMimeType('STYLE.CSS')).toBe('text/css; charset=utf-8');
  });
});
