import { describe, it, expect } from 'vitest';
import { parseRulesAddArgs, parseRulesUpdateArgs } from '../commands/rules.js';

describe('parseRulesAddArgs --allow-unlisted-files', () => {
  it('omitted flag leaves allowUnlistedFiles undefined', () => {
    const opts = parseRulesAddArgs(['myorg/*', '--access', 'public']);
    expect(opts.allowUnlistedFiles).toBeUndefined();
  });

  it('parses true and false', () => {
    expect(
      parseRulesAddArgs(['myorg/*', '--access', 'password', '--allow-unlisted-files', 'true'])
        .allowUnlistedFiles,
    ).toBe(true);
    expect(
      parseRulesAddArgs(['myorg/*', '--access', 'password', '--allow-unlisted-files', 'false'])
        .allowUnlistedFiles,
    ).toBe(false);
  });

  it('ignores invalid values', () => {
    const opts = parseRulesAddArgs([
      'myorg/*',
      '--access',
      'password',
      '--allow-unlisted-files',
      'deny',
    ]);
    expect(opts.allowUnlistedFiles).toBeUndefined();
  });
});

describe('parseRulesUpdateArgs --allow-unlisted-files', () => {
  it('parses rule id and flag', () => {
    const opts = parseRulesUpdateArgs(['rule_xyz', '--allow-unlisted-files', 'true']);
    expect(opts.ruleId).toBe('rule_xyz');
    expect(opts.allowUnlistedFiles).toBe(true);
  });
});
