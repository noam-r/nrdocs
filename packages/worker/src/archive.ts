/**
 * Tar.gz archive extraction with security validation.
 * Implements minimal tar parsing using DecompressionStream for gzip.
 */

import {
  validateAssetFilePath,
  DEFAULT_MAX_FILE_COUNT,
  DEFAULT_MAX_EXTRACTED_SIZE_MB,
  DEFAULT_MAX_SINGLE_FILE_SIZE_MB,
  isIgnoredPublishPath,
} from '@nrdocs/shared';

export interface ExtractedFile {
  path: string;
  content: Uint8Array;
  size: number;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  manifest: Record<string, unknown>;
  totalSize: number;
  fileCount: number;
}

export interface ExtractionError {
  code: string;
  message: string;
}

export interface ExtractionLimits {
  maxFileCount?: number;
  maxTotalSize?: number;
  maxSingleFileSize?: number;
}

const MANIFEST_FILENAME = 'nrdocs-manifest.json';

/**
 * Validates a file path for security issues.
 * Exported for unit testing.
 */
export function validatePath(filePath: string): ExtractionError | null {
  if (!filePath || filePath.length === 0) {
    return { code: 'INVALID_PATH', message: 'Empty file path' };
  }

  // Reject null bytes
  if (filePath.includes('\0')) {
    return { code: 'INVALID_PATH', message: `Path contains null bytes: ${filePath}` };
  }

  // Reject absolute paths
  if (filePath.startsWith('/')) {
    return { code: 'PATH_TRAVERSAL', message: `Absolute path not allowed: ${filePath}` };
  }

  // Reject backslashes
  if (filePath.includes('\\')) {
    return { code: 'PATH_TRAVERSAL', message: `Backslash not allowed in path: ${filePath}` };
  }

  // Reject path traversal
  if (filePath.includes('..')) {
    return { code: 'PATH_TRAVERSAL', message: `Path traversal not allowed: ${filePath}` };
  }

  return null;
}

/**
 * Validates a file extension against whitelist / unlisted / forbidden policy.
 * The manifest file is exempt from extension filtering.
 */
export function validateExtension(
  filePath: string,
  options?: { allowUnlisted?: boolean },
): ExtractionError | null {
  const result = validateAssetFilePath(filePath, {
    allowUnlisted: options?.allowUnlisted ?? false,
  });
  if (result.ok) return null;
  return {
    code: result.code ?? 'INVALID_EXTENSION',
    message: result.message ?? `Invalid file: ${filePath}`,
  };
}

/**
 * Extracts a .tar.gz archive and returns the file entries.
 */
export async function extractArtifact(
  archive: ArrayBuffer,
  limits?: ExtractionLimits,
  options?: { allowUnlisted?: boolean },
): Promise<{ ok: true; result: ExtractionResult } | { ok: false; error: ExtractionError }> {
  const maxFileCount = limits?.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
  const maxTotalSize = limits?.maxTotalSize ?? DEFAULT_MAX_EXTRACTED_SIZE_MB * 1024 * 1024;
  const maxSingleFileSize = limits?.maxSingleFileSize ?? DEFAULT_MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024;

  // Decompress gzip
  let tarData: Uint8Array;
  try {
    tarData = await decompressGzip(archive);
  } catch (_e) {
    return { ok: false, error: { code: 'DECOMPRESSION_FAILED', message: 'Failed to decompress gzip archive' } };
  }

  // Parse tar
  const files: ExtractedFile[] = [];
  let totalSize = 0;
  let hasManifest = false;
  let manifest: Record<string, unknown> = {};

  let offset = 0;
  while (offset < tarData.length) {
    // Check for end-of-archive (two consecutive 512-byte blocks of zeros)
    if (offset + 512 > tarData.length) break;
    if (isZeroBlock(tarData, offset)) break;

    // Parse tar header
    const header = parseTarHeader(tarData, offset);
    if (!header) break;

    offset += 512;

    // Skip non-regular files (directories, symlinks, etc.)
    if (header.type !== '0' && header.type !== '' && header.type !== null) {
      // Reject symlinks and hardlinks explicitly
      if (header.type === '1' || header.type === '2') {
        return {
          ok: false,
          error: { code: 'INVALID_ENTRY_TYPE', message: `Symlinks/hardlinks not allowed: ${header.name}` },
        };
      }
      // Reject device files, FIFOs, etc.
      if (header.type === '3' || header.type === '4' || header.type === '6') {
        return {
          ok: false,
          error: { code: 'INVALID_ENTRY_TYPE', message: `Special file type not allowed: ${header.name}` },
        };
      }
      // Skip directories (type '5') and other types silently
      const blocks = Math.ceil(header.size / 512);
      offset += blocks * 512;
      continue;
    }

    // Skip zero-size entries (e.g., directory markers with type '0')
    if (header.size === 0) continue;

    // Validate path
    const pathError = validatePath(header.name);
    if (pathError) return { ok: false, error: pathError };

    // Skip OS junk / dotfiles — never published, must not fail the upload
    if (isIgnoredPublishPath(header.name)) {
      const blocks = Math.ceil(header.size / 512);
      offset += blocks * 512;
      continue;
    }

    // Validate extension
    const extError = validateExtension(header.name, {
      allowUnlisted: options?.allowUnlisted ?? false,
    });
    if (extError) return { ok: false, error: extError };

    // Check single file size
    if (header.size > maxSingleFileSize) {
      return {
        ok: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds size limit (${header.size} bytes): ${header.name}`,
        },
      };
    }

    // Check total size
    totalSize += header.size;
    if (totalSize > maxTotalSize) {
      return {
        ok: false,
        error: { code: 'TOTAL_SIZE_EXCEEDED', message: `Total extracted size exceeds limit` },
      };
    }

    // Check file count
    if (files.length >= maxFileCount) {
      return {
        ok: false,
        error: { code: 'FILE_COUNT_EXCEEDED', message: `File count exceeds limit of ${maxFileCount}` },
      };
    }

    // Extract file content
    const content = tarData.slice(offset, offset + header.size);
    files.push({ path: header.name, content, size: header.size });

    // Track manifest
    const basename = header.name.split('/').pop() ?? header.name;
    if (basename === MANIFEST_FILENAME) {
      hasManifest = true;
      try {
        const decoder = new TextDecoder();
        manifest = JSON.parse(decoder.decode(content)) as Record<string, unknown>;
      } catch (_e) {
        return { ok: false, error: { code: 'INVALID_MANIFEST', message: 'nrdocs-manifest.json is not valid JSON' } };
      }
    }

    // Advance past file content (padded to 512-byte boundary)
    const blocks = Math.ceil(header.size / 512);
    offset += blocks * 512;
  }

  if (!hasManifest) {
    return {
      ok: false,
      error: { code: 'MISSING_MANIFEST', message: 'Archive must contain nrdocs-manifest.json' },
    };
  }

  return {
    ok: true,
    result: {
      files,
      manifest,
      totalSize,
      fileCount: files.length,
    },
  };
}

interface TarHeader {
  name: string;
  size: number;
  type: string | null;
}

/**
 * Parses a 512-byte tar header block.
 */
function parseTarHeader(data: Uint8Array, offset: number): TarHeader | null {
  // Name: bytes 0-99
  const name = readString(data, offset, 100);
  if (!name) return null;

  // Size: bytes 124-135 (octal)
  const sizeStr = readString(data, offset + 124, 12);
  const size = parseOctal(sizeStr);

  // Type flag: byte 156
  const typeByte = data[offset + 156];
  const type = typeByte === 0 ? null : String.fromCharCode(typeByte!);

  // Check for UStar prefix (bytes 345-499)
  const prefix = readString(data, offset + 345, 155);
  const fullName = prefix ? `${prefix}/${name}` : name;

  // Strip leading ./ if present
  const normalizedName = fullName.replace(/^\.\//, '');

  return { name: normalizedName, size, type };
}

/**
 * Reads a null-terminated string from a byte array.
 */
function readString(data: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && data[end] !== 0) {
    end++;
  }
  const decoder = new TextDecoder();
  return decoder.decode(data.slice(offset, end)).trim();
}

/**
 * Parses an octal string (tar format) to a number.
 */
function parseOctal(str: string): number {
  const trimmed = str.trim();
  if (!trimmed) return 0;
  return parseInt(trimmed, 8) || 0;
}

/**
 * Checks if a 512-byte block is all zeros (end-of-archive marker).
 */
function isZeroBlock(data: Uint8Array, offset: number): boolean {
  for (let i = 0; i < 512 && offset + i < data.length; i++) {
    if (data[offset + i] !== 0) return false;
  }
  return true;
}

/**
 * Decompresses gzip data using DecompressionStream API.
 */
async function decompressGzip(data: ArrayBuffer): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write data and close
  writer.write(new Uint8Array(data));
  writer.close();

  // Read all decompressed chunks
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    totalLength += (value as Uint8Array).length;
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}
