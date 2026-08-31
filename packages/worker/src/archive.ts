import { LIMITS } from './limits.js';
import { ApiError } from './http.js';
import { PublisherApiErrorCode } from '@nrdocs/contracts';

export type ArchiveFile = {
  path: string;
  body: Uint8Array;
};

function assertSafePath(path: string): void {
  const utf8 = new TextEncoder().encode(path);
  if (utf8.byteLength > LIMITS.maxArchivePathBytes) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Archive path exceeds length limit.');
  }
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Archive path is unsafe.');
  }
  const parts = path.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Archive path is unsafe.');
    }
    if (new TextEncoder().encode(part).byteLength > LIMITS.maxArchiveSegmentBytes) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive path segment exceeds length limit.',
      );
    }
  }
  const top = parts[0];
  if (
    top !== 'nrdocs-manifest.json' &&
    top !== 'pages' &&
    top !== 'assets' &&
    top !== 'attachments' &&
    top !== 'agent' &&
    top !== 'openapi'
  ) {
    throw new ApiError(
      PublisherApiErrorCode.InvalidArtifact,
      'Archive entry is outside allowed top-level paths.',
    );
  }
}

async function gunzipBounded(compressed: Uint8Array, maxUncompressed: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ApiError(
      PublisherApiErrorCode.TemporarilyUnavailable,
      'gzip decompression is unavailable in this runtime.',
    );
  }
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([Uint8Array.from(compressed)]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxUncompressed) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new ApiError(
        PublisherApiErrorCode.ArtifactTooLarge,
        'Uncompressed artifact exceeds size limit.',
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function readCString(buf: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(start, end));
}

function parseOctal(buf: Uint8Array, start: number, length: number): number {
  const raw = readCString(buf, start, length).trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Invalid tar header size.');
  }
  return n;
}

/**
 * Extract regular-file entries from a ustar archive with hard limits.
 * Directory entries are ignored (directories are implicit). Links and special files are rejected.
 */
export function extractUstarFiles(tar: Uint8Array): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let uncompressedTotal = 0;

  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((b) => b === 0)) {
      // End-of-archive marker (two zero blocks); stop after first.
      break;
    }

    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(header, 124, 12);
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);

    const padded = size + ((512 - (size % 512)) % 512);
    if (offset + padded > tar.byteLength) {
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Truncated tar archive.');
    }
    const body = tar.subarray(offset, offset + size);
    offset += padded;

    if (typeFlag === '5') {
      // Directory — ignore
      continue;
    }
    if (typeFlag !== '0' && typeFlag !== '\0') {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive contains unsupported entry types.',
      );
    }
    if (!path || path.endsWith('/')) {
      continue;
    }

    assertSafePath(path);
    if (seen.has(path)) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidArtifact,
        'Archive contains duplicate paths.',
      );
    }
    seen.add(path);

    uncompressedTotal += body.byteLength;
    if (uncompressedTotal > LIMITS.uncompressedMaxBytes) {
      throw new ApiError(
        PublisherApiErrorCode.ArtifactTooLarge,
        'Uncompressed artifact exceeds size limit.',
      );
    }
    if (files.length + 1 > LIMITS.maxDeclaredFilesWithOpenApi + 1) {
      // +1 allows manifest + max payload files (OpenAPI-raised ceiling; schema
      // version is enforced later in validateExpandedArtifact).
      throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Archive declares too many files.');
    }

    files.push({ path, body: body.slice() });
  }

  return files;
}

export async function expandArtifactArchive(compressed: Uint8Array): Promise<ArchiveFile[]> {
  if (compressed.byteLength > LIMITS.compressedMaxBytes) {
    throw new ApiError(
      PublisherApiErrorCode.ArtifactTooLarge,
      'Compressed artifact exceeds size limit.',
    );
  }
  const maxUncompressed = Math.min(
    LIMITS.uncompressedMaxBytes,
    Math.max(compressed.byteLength * LIMITS.maxExpansionRatio, compressed.byteLength),
  );
  let tar: Uint8Array;
  try {
    tar = await gunzipBounded(compressed, maxUncompressed);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      PublisherApiErrorCode.UnsupportedArtifactFormat,
      'Artifact must be a gzip-compressed tar archive.',
    );
  }
  if (tar.byteLength > compressed.byteLength * LIMITS.maxExpansionRatio) {
    throw new ApiError(
      PublisherApiErrorCode.ArtifactTooLarge,
      'Uncompressed-to-compressed ratio exceeds limit.',
    );
  }
  try {
    return extractUstarFiles(tar);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(PublisherApiErrorCode.InvalidArtifact, 'Archive is invalid.');
  }
}
