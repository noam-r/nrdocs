/**
 * Archive packager — creates .tar.gz from rendered files.
 * Uses minimal tar implementation with node:zlib for compression.
 */
import * as zlib from 'node:zlib';
import type { RenderedFile } from './index.js';

/**
 * Creates a .tar.gz archive from rendered files and manifest.
 */
export async function createArchive(
  files: RenderedFile[],
  manifest: Record<string, unknown>
): Promise<Buffer> {
  // Add manifest to files
  const allFiles: RenderedFile[] = [
    ...files,
    {
      path: 'nrdocs-manifest.json',
      content: Buffer.from(JSON.stringify(manifest, null, 2)),
    },
  ];

  const tarBuffer = createTar(allFiles);
  return gzipCompress(tarBuffer);
}

/**
 * Creates a tar archive buffer from files.
 * Uses 512-byte headers with POSIX ustar format.
 */
function createTar(files: RenderedFile[]): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    const header = createTarHeader(file.path, file.content.length);
    blocks.push(header);

    // File content padded to 512-byte boundary
    const content = Buffer.from(file.content);
    blocks.push(content);

    const padding = 512 - (content.length % 512);
    if (padding < 512) {
      blocks.push(Buffer.alloc(padding, 0));
    }
  }

  // Two zero blocks at end (EOF marker)
  blocks.push(Buffer.alloc(1024, 0));

  return Buffer.concat(blocks);
}

/**
 * Creates a 512-byte tar header for a file entry.
 */
function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);

  // Name (0-99, 100 bytes)
  writeString(header, name, 0, 100);

  // Mode (100-107, 8 bytes) — 0644
  writeOctal(header, 0o644, 100, 8);

  // UID (108-115, 8 bytes)
  writeOctal(header, 0, 108, 8);

  // GID (116-123, 8 bytes)
  writeOctal(header, 0, 116, 8);

  // Size (124-135, 12 bytes)
  writeOctal(header, size, 124, 12);

  // Mtime (136-147, 12 bytes) — current time
  writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);

  // Checksum placeholder (148-155, 8 bytes) — spaces for calculation
  header.fill(0x20, 148, 156);

  // Type flag (156, 1 byte) — '0' for regular file
  header[156] = 0x30; // '0'

  // USTAR magic (257-262)
  writeString(header, 'ustar', 257, 6);

  // USTAR version (263-264)
  writeString(header, '00', 263, 2);

  // Calculate and write checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i]!;
  }
  writeOctal(header, checksum, 148, 8);

  return header;
}

function writeString(buf: Buffer, str: string, offset: number, length: number): void {
  const bytes = Buffer.from(str, 'utf-8');
  bytes.copy(buf, offset, 0, Math.min(bytes.length, length - 1));
}

function writeOctal(buf: Buffer, value: number, offset: number, length: number): void {
  const str = value.toString(8).padStart(length - 1, '0');
  writeString(buf, str, offset, length);
}

/**
 * Compresses a buffer with gzip.
 */
function gzipCompress(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
