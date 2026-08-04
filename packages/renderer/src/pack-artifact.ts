import { gzipSync } from 'node:zlib';
import { canonicalizeJson } from '@nrdocs/contracts';
import type { InMemoryArtifact, RenderedFile } from './render-publication.js';

const USTAR_MAGIC = 'ustar\0';
const USTAR_VERSION = '00';

function encodeOctal(value: number, length: number): string {
  const body = value.toString(8);
  return body.padStart(length - 1, '0') + '\0';
}

function writeString(buf: Buffer, offset: number, value: string, length: number): void {
  buf.fill(0, offset, offset + length);
  buf.write(value.slice(0, length - 1), offset, 'utf8');
}

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += i >= 148 && i < 156 ? 32 : header[i]!;
  }
  return sum;
}

function tarHeader(name: string, size: number, typeFlag: string = '0'): Buffer {
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, name, 100);
  writeString(header, 100, encodeOctal(0o644, 8), 8);
  writeString(header, 108, encodeOctal(0, 8), 8); // uid
  writeString(header, 116, encodeOctal(0, 8), 8); // gid
  writeString(header, 124, encodeOctal(size, 12), 12);
  writeString(header, 136, encodeOctal(0, 12), 12); // mtime epoch
  header.fill(0x20, 148, 156); // checksum blank
  header[156] = typeFlag.charCodeAt(0);
  writeString(header, 257, USTAR_MAGIC, 6);
  writeString(header, 263, USTAR_VERSION, 2);
  writeString(header, 265, 'root', 32);
  writeString(header, 297, 'root', 32);
  const sum = checksum(header);
  writeString(header, 148, encodeOctal(sum, 8), 8);
  return header;
}

function pad512(size: number): number {
  return (512 - (size % 512)) % 512;
}

/** Build a deterministic ustar archive (file entries only, sorted as given). */
export function buildDeterministicTar(files: readonly RenderedFile[]): Uint8Array {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const name = file.objectPath;
    if (name.length > 100) {
      // Use ustar prefix split if needed — keep Phase 4 paths short in fixtures
      throw new Error(`Archive path too long for ustar name field: ${name}`);
    }
    const data = Buffer.from(file.bytes);
    chunks.push(tarHeader(name, data.byteLength));
    chunks.push(data);
    const pad = pad512(data.byteLength);
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  // Two empty blocks end the archive
  chunks.push(Buffer.alloc(1024, 0));
  return new Uint8Array(Buffer.concat(chunks));
}

/** Gzip with mtime zeroed so digests/bytes are stable. */
export function gzipDeterministic(tarBytes: Uint8Array): Uint8Array {
  const gz = gzipSync(Buffer.from(tarBytes), { level: 9 });
  // Zero mtime (bytes 4..7) and set OS to unknown (255) for stability
  gz[4] = 0;
  gz[5] = 0;
  gz[6] = 0;
  gz[7] = 0;
  gz[9] = 255;
  return new Uint8Array(gz);
}

export function packArtifact(artifact: InMemoryArtifact): {
  gzipBytes: Uint8Array;
  tarBytes: Uint8Array;
  digest: string;
} {
  // Ensure manifest file bytes match sealed logical document as compact JSON
  const files = artifact.files.map((f) => {
    if (f.objectPath !== 'nrdocs-manifest.json') return f;
    // Archive stores the sealed manifest as canonical-ish compact JSON with sorted keys via canonicalize
    const canonical = canonicalizeJson(
      JSON.parse(new TextDecoder().decode(f.bytes)) as Parameters<typeof canonicalizeJson>[0],
    );
    return { objectPath: f.objectPath, bytes: new TextEncoder().encode(canonical) };
  });

  const tarBytes = buildDeterministicTar(files);
  const gzipBytes = gzipDeterministic(tarBytes);
  return {
    gzipBytes,
    tarBytes,
    digest: artifact.manifest.artifact.digest,
  };
}
