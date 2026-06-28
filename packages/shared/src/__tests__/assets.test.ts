import { describe, it, expect } from 'vitest';
import {
  WHITELISTED_ASSET_EXTENSIONS,
  classifyAssetExtension,
  validateAssetFilePath,
  findUnlistedAssetPaths,
  isIgnoredPublishPath,
  isNrdocsExportArtifactPath,
  nrdocsSourceArtifactPath,
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

  it('allows export source and site zip under _nrdocs/', () => {
    expect(isNrdocsExportArtifactPath('_nrdocs/sources/index.md')).toBe(true);
    expect(isNrdocsExportArtifactPath('_nrdocs/export/site.zip')).toBe(true);
    expect(validateAssetFilePath('_nrdocs/sources/guide.md').ok).toBe(true);
    expect(validateAssetFilePath('_nrdocs/export/site.zip').ok).toBe(true);
    expect(nrdocsSourceArtifactPath('docs/page.md')).toBe('_nrdocs/sources/docs/page.md');
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

  it('ignores common OS junk files', () => {
    expect(isIgnoredPublishPath('.DS_Store')).toBe(true);
    expect(isIgnoredPublishPath('assets/.DS_Store')).toBe(true);
    expect(isIgnoredPublishPath('Thumbs.db')).toBe(true);
    expect(isIgnoredPublishPath('images/._photo.png')).toBe(true);
    expect(isIgnoredPublishPath('.hidden')).toBe(true);
    expect(isIgnoredPublishPath('node_modules/pkg/index.js')).toBe(true);
    expect(isIgnoredPublishPath('logo.png')).toBe(false);
  });

  it('validateAssetFilePath accepts ignored junk without failing', () => {
    const r = validateAssetFilePath('docs/.DS_Store');
    expect(r.ok).toBe(true);
    expect(r.classification).toBe('ignored');
  });

  it('findUnlistedAssetPaths skips ignored junk', () => {
    expect(findUnlistedAssetPaths(['.DS_Store', 'bundle.zip'])).toEqual(['bundle.zip']);
  });
});
