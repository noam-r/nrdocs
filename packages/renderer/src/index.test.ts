import { describe, expect, it } from 'vitest';
import { RENDERER_PACKAGE, rendererDependsOnContracts } from './index.js';

describe('@nrdocs/renderer', () => {
  it('imports contracts', () => {
    expect(RENDERER_PACKAGE).toBe('@nrdocs/renderer');
    expect(rendererDependsOnContracts()).toBe('@nrdocs/contracts');
  });
});
