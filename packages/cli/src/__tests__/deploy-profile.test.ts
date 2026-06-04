import { describe, it, expect } from 'vitest';
import {
  isUsableDeployProfile,
  hasDeployCliOverrides,
  parseDeployArgs,
} from '../commands/deploy.js';
import type { Profile } from '../config/schema.js';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    api_url: 'https://docs.example.com',
    operator_token: 'nrdocs_op_test',
    deployment_name: 'default',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isUsableDeployProfile', () => {
  it('accepts profile with api_url and operator_token', () => {
    expect(isUsableDeployProfile(profile())).toBe(true);
  });

  it('rejects profile missing api_url or token', () => {
    expect(isUsableDeployProfile(profile({ api_url: '' }))).toBe(false);
    expect(isUsableDeployProfile(profile({ operator_token: '' }))).toBe(false);
  });
});

describe('hasDeployCliOverrides', () => {
  it('is false with no deploy flags', () => {
    expect(hasDeployCliOverrides(parseDeployArgs([]))).toBe(false);
  });

  it('is true when instance or URL or token flags are set', () => {
    expect(hasDeployCliOverrides(parseDeployArgs(['--instance', 'prod']))).toBe(true);
    expect(hasDeployCliOverrides(parseDeployArgs(['--base-url', 'https://x.com']))).toBe(
      true,
    );
    expect(hasDeployCliOverrides(parseDeployArgs(['--operator-token', 'tok']))).toBe(true);
  });
});
