import { describe, expect, it } from 'vitest';
import { CLI_PACKAGE, CLI_VERSION, cliDependencies, main } from './index.js';

describe('nrdocs cli package', () => {
  it('is the only public package identity', () => {
    expect(CLI_PACKAGE).toBe('nrdocs');
    expect(CLI_VERSION).toBe('2.0.0');
    expect(cliDependencies().contracts).toBe('@nrdocs/contracts');
  });

  it('prints version without inventing product commands', () => {
    expect(main(['--version'])).toBe(0);
  });
});
