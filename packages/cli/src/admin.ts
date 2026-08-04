import type { CommandContext } from './command-context.js';
import type { AdminOptions } from './admin/context.js';
import { runSiteCommand } from './admin/site.js';
import { runTokenCommand } from './admin/token.js';

export type { AdminOptions } from './admin/context.js';
export { runSiteCommand } from './admin/site.js';
export { runTokenCommand } from './admin/token.js';
export { parseTtlDuration, MAX_TTL_SECONDS } from './admin/ttl.js';
export {
  derivePasswordVerifier,
  generatePublishingToken,
  assertReaderPassword,
} from './admin/crypto.js';

export async function runAdminSiteCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions = {},
): Promise<void> {
  return runSiteCommand(ctx, args, options);
}

export async function runAdminTokenCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions = {},
): Promise<void> {
  return runTokenCommand(ctx, args, options);
}
