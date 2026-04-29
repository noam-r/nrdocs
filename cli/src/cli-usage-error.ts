/** Expected CLI failure (bad env, validation); print message only, no stack trace. */
export class CliUsageError extends Error {
  override readonly name = 'CliUsageError';

  constructor(message: string) {
    super(message);
  }
}
