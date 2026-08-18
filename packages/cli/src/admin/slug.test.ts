import { describe, expect, it } from 'vitest';
import { CliError } from '../errors.js';
import { requireSiteSlug, SITE_SLUG_RULES } from './slug.js';

describe('requireSiteSlug', () => {
  it('folds ASCII case and trim before validation', () => {
    expect(requireSiteSlug('  Product-Handbook  ')).toBe('product-handbook');
  });

  it('rejects other invalid input with the slug rules', () => {
    expect(() => requireSiteSlug('has_underscore')).toThrow(CliError);
    try {
      requireSiteSlug('has_underscore');
    } catch (error) {
      expect((error as CliError).safe_message).toContain(SITE_SLUG_RULES);
      expect((error as CliError).safe_message).toContain('has_underscore');
    }
  });
});
