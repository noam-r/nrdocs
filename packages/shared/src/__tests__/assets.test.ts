import { describe, it, expect } from 'vitest';
import {
  WHITELISTED_ASSET_EXTENSIONS,
  classifyAssetExtension,
  validateAssetFilePath,
  findUnlistedAssetPaths,
} from '../assets.js';

describe('asset extension policy', () => {
  it('whitelists yaml and yml', () => {
    expect(WHITELISTED_ASSET_EXTENSIONS.has('.yaml')).toBe(true);
    expect(WHITELISTED_ASSET_EXTENSIONS.has('.yml')).toBe(true);
    expect(classifyAssetExtension('.yaml')).toBe('whitelisted');
  });

  it('treats zip as unlisted', () => {
    expect(classifyAssetExtension('.zip')).toBe('unlisted');
  });

  it('treats js as forbidden', () => {
    expect(classifyAssetExtension('.js')).toBe('forbidden');
  });

  it('allows platform runtime .js under _nrdocs/', () => {
    const r = validateAssetFilePath('_nrdocs/mermaid.min.js');
    expect(r.ok).toBe(true);
  });

  it('allows unlisted when allowUnlisted is true', () => {
    const r = validateAssetFilePath('schemas/data.zip', { allowUnlisted: true });
    expect(r.ok).toBe(true);
    expect(r.classification).toBe('unlisted');
  });

  it('rejects unlisted by default', () => {
    const r = validateAssetFilePath('schemas/data.zip', {});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EXTENSION_NOT_PERMITTED');
  });

  it('findUnlistedAssetPaths skips manifest and whitelisted files', () => {
    const paths = findUnlistedAssetPaths([
      'nrdocs-manifest.json',
      'index.html',
      'schemas/api.yaml',
      'bundle.zip',
    ]);
    expect(paths).toEqual(['bundle.zip']);
  });
});
