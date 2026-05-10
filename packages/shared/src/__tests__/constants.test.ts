import { describe, it, expect } from 'vitest';
import {
  NRDOCS_VERSION,
  APPROVAL_STATES,
  ACCESS_MODES,
  BUILD_STATUSES,
  DEFAULT_PBKDF2_ITERATIONS,
  ALLOWED_ASSET_EXTENSIONS,
  REJECTED_EXTENSIONS,
} from '../index.js';

describe('constants', () => {
  it('exports a version string', () => {
    expect(NRDOCS_VERSION).toBe('0.1.0');
  });

  it('defines approval states', () => {
    expect(APPROVAL_STATES).toContain('pending');
    expect(APPROVAL_STATES).toContain('approved');
    expect(APPROVAL_STATES).toContain('disabled');
    expect(APPROVAL_STATES).toHaveLength(3);
  });

  it('defines access modes', () => {
    expect(ACCESS_MODES).toContain('none');
    expect(ACCESS_MODES).toContain('public');
    expect(ACCESS_MODES).toContain('password');
    expect(ACCESS_MODES).toHaveLength(3);
  });

  it('defines build statuses', () => {
    expect(BUILD_STATUSES).toContain('uploading');
    expect(BUILD_STATUSES).toContain('success');
    expect(BUILD_STATUSES).toContain('failed');
    expect(BUILD_STATUSES).toHaveLength(3);
  });

  it('sets PBKDF2 iterations to 100000', () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBe(100_000);
  });

  it('allows expected asset extensions', () => {
    expect(ALLOWED_ASSET_EXTENSIONS.has('.html')).toBe(true);
    expect(ALLOWED_ASSET_EXTENSIONS.has('.png')).toBe(true);
    expect(ALLOWED_ASSET_EXTENSIONS.has('.svg')).toBe(true);
    expect(ALLOWED_ASSET_EXTENSIONS.has('.pdf')).toBe(true);
  });

  it('rejects .js extensions', () => {
    expect(REJECTED_EXTENSIONS.has('.js')).toBe(true);
    expect(REJECTED_EXTENSIONS.has('.mjs')).toBe(true);
  });
});
