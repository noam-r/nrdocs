import { describe, expect, it } from 'vitest';
import {
  decodeRepoContentAssets,
  PUBLISH_ASSET_MAX_COUNT,
  PUBLISH_ASSET_MAX_FILE_BYTES,
  PUBLISH_ASSET_MAX_TOTAL_BYTES,
} from './asset-ingest.js';

/** 1×1 transparent PNG */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('decodeRepoContentAssets', () => {
  it('returns empty array when assets omitted or null', () => {
    expect(decodeRepoContentAssets(undefined)).toEqual({ ok: true, items: [] });
    expect(decodeRepoContentAssets(null)).toEqual({ ok: true, items: [] });
  });

  it('decodes a valid PNG asset', () => {
    const r = decodeRepoContentAssets({ 'img/x.png': TINY_PNG_B64 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].path).toBe('img/x.png');
    expect(r.items[0].contentType).toBe('image/png');
    expect(r.items[0].content.byteLength).toBeGreaterThan(0);
  });

  it('rejects non-object assets', () => {
    expect(decodeRepoContentAssets([]).ok).toBe(false);
    expect(decodeRepoContentAssets('x').ok).toBe(false);
  });

  it('rejects invalid paths', () => {
    expect(decodeRepoContentAssets({ '../x.png': TINY_PNG_B64 }).ok).toBe(false);
    expect(decodeRepoContentAssets({ '/abs.png': TINY_PNG_B64 }).ok).toBe(false);
    expect(decodeRepoContentAssets({ 'bad/.png': TINY_PNG_B64 }).ok).toBe(false);
    expect(decodeRepoContentAssets({ 'noext': 'YQ==' }).ok).toBe(false);
    expect(decodeRepoContentAssets({ 'x.md': TINY_PNG_B64 }).ok).toBe(false);
  });

  it('rejects .svg in publish assets', () => {
    expect(decodeRepoContentAssets({ 'a.svg': 'PHN2Zy8+' }).ok).toBe(false);
  });

  it('rejects invalid base64', () => {
    expect(decodeRepoContentAssets({ 'a.png': 'not!!!base64' }).ok).toBe(false);
  });

  it('rejects oversize file', () => {
    const big = Buffer.alloc(PUBLISH_ASSET_MAX_FILE_BYTES + 1).toString('base64');
    const r = decodeRepoContentAssets({ 'big.png': big });
    expect(r.ok).toBe(false);
  });

  it('rejects total size over cap', () => {
    const chunk = PUBLISH_ASSET_MAX_TOTAL_BYTES / 2 + 1;
    const half = Buffer.alloc(chunk).toString('base64');
    const r = decodeRepoContentAssets({
      'a.png': half,
      'b.png': half,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects too many files', () => {
    const o: Record<string, string> = {};
    for (let i = 0; i <= PUBLISH_ASSET_MAX_COUNT; i++) {
      o[`p${i}.png`] = TINY_PNG_B64;
    }
    expect(decodeRepoContentAssets(o).ok).toBe(false);
  });
});
