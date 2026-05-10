import { describe, it, expect } from 'vitest';
import {
  validateInstanceName,
  getWorkerName,
  getD1Name,
  getR2BucketName,
  getResourceNames,
} from '../naming.js';

describe('validateInstanceName', () => {
  it('accepts valid names', () => {
    expect(validateInstanceName('prod').valid).toBe(true);
    expect(validateInstanceName('staging').valid).toBe(true);
    expect(validateInstanceName('my-docs').valid).toBe(true);
    expect(validateInstanceName('a').valid).toBe(true);
    expect(validateInstanceName('team1').valid).toBe(true);
    expect(validateInstanceName('default').valid).toBe(true);
  });

  it('rejects empty names', () => {
    const result = validateInstanceName('');
    expect(result.valid).toBe(false);
  });

  it('rejects names longer than 20 characters', () => {
    const result = validateInstanceName('a'.repeat(21));
    expect(result.valid).toBe(false);
  });

  it('accepts names exactly 20 characters', () => {
    const result = validateInstanceName('a'.repeat(20));
    expect(result.valid).toBe(true);
  });

  it('rejects names starting with a hyphen', () => {
    const result = validateInstanceName('-prod');
    expect(result.valid).toBe(false);
  });

  it('rejects names ending with a hyphen', () => {
    const result = validateInstanceName('prod-');
    expect(result.valid).toBe(false);
  });

  it('rejects uppercase characters', () => {
    const result = validateInstanceName('Prod');
    expect(result.valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(validateInstanceName('my_docs').valid).toBe(false);
    expect(validateInstanceName('my.docs').valid).toBe(false);
    expect(validateInstanceName('my docs').valid).toBe(false);
    expect(validateInstanceName('my@docs').valid).toBe(false);
  });
});

describe('resource naming', () => {
  it('getWorkerName returns nrdocs-{instance}', () => {
    expect(getWorkerName('prod')).toBe('nrdocs-prod');
    expect(getWorkerName('staging')).toBe('nrdocs-staging');
    expect(getWorkerName('default')).toBe('nrdocs-default');
  });

  it('getD1Name returns nrdocs-{instance}-db', () => {
    expect(getD1Name('prod')).toBe('nrdocs-prod-db');
    expect(getD1Name('staging')).toBe('nrdocs-staging-db');
  });

  it('getR2BucketName returns nrdocs-{instance}-artifacts', () => {
    expect(getR2BucketName('prod')).toBe('nrdocs-prod-artifacts');
    expect(getR2BucketName('staging')).toBe('nrdocs-staging-artifacts');
  });

  it('getResourceNames returns all three', () => {
    const names = getResourceNames('prod');
    expect(names.worker).toBe('nrdocs-prod');
    expect(names.d1).toBe('nrdocs-prod-db');
    expect(names.r2).toBe('nrdocs-prod-artifacts');
  });
});
