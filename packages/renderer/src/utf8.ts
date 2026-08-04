import { RendererError, MAX_MARKDOWN_BYTES } from './types.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Decode Markdown source bytes per the locked UTF-8 / BOM / EOL contract.
 * Returns normalized LF text and whether a leading BOM was stripped.
 */
export function decodeMarkdownSource(bytes: Uint8Array, sourceFile: string): string {
  if (bytes.byteLength > MAX_MARKDOWN_BYTES) {
    throw new RendererError('markdown_too_large', `Markdown file exceeds 1 MiB:\n  ${sourceFile}`, {
      sourceFile,
    });
  }

  // Reject non-leading BOM occurrences after decode checks
  let offset = 0;
  let hadBom = false;
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  ) {
    hadBom = true;
    offset = 3;
  }

  const slice = bytes.subarray(offset);
  // Validate UTF-8 strictly
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = decoder.decode(slice);
  } catch {
    throw new RendererError('invalid_utf8', `Markdown file is not valid UTF-8:\n  ${sourceFile}`, {
      sourceFile,
    });
  }

  // Reject BOM elsewhere (U+FEFF)
  if (text.includes('\uFEFF')) {
    throw new RendererError(
      'invalid_bom',
      hadBom
        ? `Markdown file contains a BOM after the leading BOM:\n  ${sourceFile}`
        : `Markdown file contains a non-leading UTF-8 BOM:\n  ${sourceFile}`,
      { sourceFile },
    );
  }

  // Normalize CRLF and lone CR to LF
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
