import { describe, it, expect } from 'vitest';
import { isValidSlug, inferSlug, inferTitle } from './slug-validator';

describe('isValidSlug', () => {
  it('accepts single lowercase letter', () => {
    expect(isValidSlug('a')).toBe(true);
  });

  it('accepts single digit', () => {
    expect(isValidSlug('5')).toBe(true);
  });

  it('accepts lowercase alphanumeric with hyphens', () => {
    expect(isValidSlug('my-project')).toBe(true);
    expect(isValidSlug('my-cool-project-123')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects leading hyphen', () => {
    expect(isValidSlug('-abc')).toBe(false);
  });

  it('rejects trailing hyphen', () => {
    expect(isValidSlug('abc-')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValidSlug('MyProject')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidSlug('my_project')).toBe(false);
    expect(isValidSlug('my.project')).toBe(false);
  });
});

describe('inferSlug', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(inferSlug('My-Project')).toBe('my-project');
  });

  it('collapses consecutive non-alphanumeric chars into single hyphen', () => {
    expect(inferSlug('my___cool...project')).toBe('my-cool-project');
  });

  it('trims leading and trailing hyphens', () => {
    expect(inferSlug('--my-project--')).toBe('my-project');
  });

  it('handles spaces and mixed separators', () => {
    expect(inferSlug('My Cool Project')).toBe('my-cool-project');
  });

  it('returns empty string for all-special-char input', () => {
    expect(inferSlug('---')).toBe('');
  });
});

describe('inferTitle', () => {
  it('replaces hyphens with spaces and title-cases', () => {
    expect(inferTitle('my-project')).toBe('My Project');
  });

  it('replaces underscores with spaces and title-cases', () => {
    expect(inferTitle('my_project')).toBe('My Project');
  });

  it('handles mixed hyphens and underscores', () => {
    expect(inferTitle('my-cool_project')).toBe('My Cool Project');
  });

  it('title-cases already spaced input', () => {
    expect(inferTitle('my project')).toBe('My Project');
  });
});
