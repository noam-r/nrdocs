import { describe, it, expect } from 'vitest';
import {
  buildArtifactPrefix,
  buildArtifactKey,
} from '../artifacts.js';

describe('buildArtifactPrefix', () => {
  it('generates correct prefix format', () => {
    const prefix = buildArtifactPrefix('repo_abc123', 'build_def456');
    expect(prefix).toBe('artifacts/repo_abc123/build_def456/');
  });

  it('always ends with a trailing slash', () => {
    const prefix = buildArtifactPrefix('repo_x', 'build_y');
    expect(prefix.endsWith('/')).toBe(true);
  });
});

describe('buildArtifactKey', () => {
  it('generates correct key for a file', () => {
    const key = buildArtifactKey('repo_abc', 'build_def', 'index.html');
    expect(key).toBe('artifacts/repo_abc/build_def/index.html');
  });

  it('handles nested file paths', () => {
    const key = buildArtifactKey('repo_abc', 'build_def', 'docs/api/index.html');
    expect(key).toBe('artifacts/repo_abc/build_def/docs/api/index.html');
  });

  it('handles manifest file', () => {
    const key = buildArtifactKey('repo_abc', 'build_def', 'nrdocs-manifest.json');
    expect(key).toBe('artifacts/repo_abc/build_def/nrdocs-manifest.json');
  });
});
