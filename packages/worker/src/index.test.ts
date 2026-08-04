import { describe, expect, it } from 'vitest';
import { WORKER_PACKAGE, workerDependencies } from './index.js';

describe('@nrdocs/worker', () => {
  it('depends on contracts and persistence only', () => {
    expect(WORKER_PACKAGE).toBe('@nrdocs/worker');
    expect(workerDependencies()).toEqual({
      contracts: '@nrdocs/contracts',
      persistence: '@nrdocs/persistence',
    });
  });
});
