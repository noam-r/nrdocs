import {
  findTokenByNameOrId,
  getAuthoritativeUtcNow,
  isTokenUsable,
  issueToken,
  listTokensForSite,
  revokeToken,
} from '@nrdocs/persistence';
import { formatId, normalizeDisplayName, type TokenRecordId } from '@nrdocs/contracts';
import type { CommandContext } from '../command-context.js';
import { parseFlags } from '../argv.js';
import { localValidationError, usageError } from '../errors.js';
import { presentHumanSuccess, presentJsonSuccess } from '../present.js';
import { confirmOrDecline } from '../terminal.js';
import { beginAdminSession, type AdminOptions } from './context.js';
import { generatePublishingToken } from './crypto.js';
import { loadSiteBySlugArg } from './site.js';
import { SITE_SLUG_RULES } from './slug.js';
import { addSecondsToRfc3339, parseTtlDuration } from './ttl.js';

export async function runTokenCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions = {},
): Promise<void> {
  const sub = args[0];
  if (ctx.help || !sub) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs token issue <slug> --name <name> [--ttl <duration>]',
        'nrdocs token list <slug>',
        'nrdocs token revoke <slug> <name-or-token-id>',
        '',
        SITE_SLUG_RULES,
      ].join('\n') + '\n',
    );
    return;
  }
  switch (sub) {
    case 'issue':
      await tokenIssue(ctx, args.slice(1), options);
      return;
    case 'list':
      await tokenList(ctx, args.slice(1), options);
      return;
    case 'revoke':
      await tokenRevoke(ctx, args.slice(1), options);
      return;
    default:
      throw usageError(`Unknown token command: ${sub}`, 'Run: nrdocs token --help');
  }
}

function tokenStatus(
  token: Awaited<ReturnType<typeof listTokensForSite>>[number],
  nowIso: string,
): 'active' | 'expired' | 'revoked' {
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && nowIso >= token.expires_at) return 'expired';
  return 'active';
}

async function tokenIssue(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { flags, positionals } = parseFlags(args, { string: ['--name', '--ttl'] });
  if (positionals.length !== 1) throw usageError('token issue requires exactly one slug.');
  const nameFlag = flags['--name'];
  if (typeof nameFlag !== 'string' || !nameFlag.trim()) {
    throw usageError('token issue requires --name <name>.');
  }
  const name = normalizeDisplayName(nameFlag);
  if (!name) throw usageError('Invalid token name.');

  let ttlSeconds: number | null = null;
  if (flags['--ttl'] !== undefined) {
    if (typeof flags['--ttl'] !== 'string') throw usageError('Invalid --ttl.');
    try {
      ttlSeconds = parseTtlDuration(flags['--ttl']);
    } catch (error) {
      throw usageError(error instanceof Error ? error.message : 'Invalid --ttl.');
    }
  }

  const session = await beginAdminSession(ctx, 'token issue', options, { mutating: true });
  const site = await loadSiteBySlugArg(session.db, positionals[0]!);

  const nowIso = await getAuthoritativeUtcNow(session.db);
  const expires_at = ttlSeconds === null ? null : addSecondsToRfc3339(nowIso, ttlSeconds);

  const tokenId = formatId(
    'tok',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as TokenRecordId;
  const { plaintext, verifier } = await generatePublishingToken();

  try {
    await issueToken(session.db, {
      id: tokenId,
      site_id: site.id,
      name,
      token_verifier: verifier,
      expires_at,
      now: new Date(Date.parse(nowIso)),
    });
  } catch (error) {
    throw localValidationError(error instanceof Error ? error.message : 'token issue failed');
  }

  presentHumanSuccess(
    ctx.runtime,
    [
      'Publishing token issued.',
      '',
      `Site:     ${site.slug}`,
      `Name:     ${name}`,
      `Token ID: ${tokenId}`,
      `Expires:  ${expires_at ?? '(none)'}`,
      '',
      `Publishing token: ${plaintext}`,
      '',
      'This token will not be displayed again.',
    ].join('\n'),
  );
}

async function tokenList(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) throw usageError('token list requires exactly one slug.');
  const session = await beginAdminSession(ctx, 'token list', options, { mutating: false });
  const site = await loadSiteBySlugArg(session.db, positionals[0]!);
  const nowIso = await getAuthoritativeUtcNow(session.db);
  const tokens = await listTokensForSite(session.db, site.id);
  const rows = tokens.map((t) => ({
    token_id: t.id,
    name: t.name,
    status: tokenStatus(t, nowIso),
    created_at: t.created_at,
    expires_at: t.expires_at,
    last_used_at: t.last_used_at,
    usable: isTokenUsable(t, nowIso),
  }));
  if (ctx.json) {
    presentJsonSuccess(ctx.runtime, { site_id: site.id, slug: site.slug, tokens: rows });
    return;
  }
  if (rows.length === 0) {
    presentHumanSuccess(ctx.runtime, `No publishing tokens for:\n  ${site.slug}`);
    return;
  }
  const lines = [`Publishing tokens for ${site.slug}:`, ''];
  for (const row of rows) {
    lines.push(`  ${row.name} (${row.status})`);
    lines.push(`    id:         ${row.token_id}`);
    lines.push(`    created:    ${row.created_at}`);
    lines.push(`    expires:    ${row.expires_at ?? '(none)'}`);
    lines.push(`    last used:  ${row.last_used_at ?? '(never)'}`);
  }
  presentHumanSuccess(ctx.runtime, lines.join('\n'));
}

async function tokenRevoke(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 2) {
    throw usageError('token revoke requires <slug> <name-or-token-id>.');
  }
  const [slugArg, nameOrId] = positionals;
  const session = await beginAdminSession(ctx, 'token revoke', options, { mutating: true });
  const site = await loadSiteBySlugArg(session.db, slugArg!);
  const token = await findTokenByNameOrId(session.db, site.id, nameOrId!);
  if (!token) {
    throw localValidationError(
      `No publishing token matching:\n  ${nameOrId}\nfor site:\n  ${site.slug}`,
    );
  }

  presentHumanSuccess(
    ctx.runtime,
    `Revoke token "${token.name}" on site ${site.slug}?\nToken ID: ${token.id}`,
  );
  if ((await confirmOrDecline(ctx.terminal, 'Revoke token?')) === 'declined') {
    presentHumanSuccess(ctx.runtime, 'Cancelled.');
    return;
  }

  const result = await revokeToken(session.db, token.id);
  if (!result.revoked && result.token?.revoked_at) {
    presentHumanSuccess(ctx.runtime, 'unchanged');
    return;
  }
  presentHumanSuccess(ctx.runtime, `Token revoked.\nSite: ${site.slug}\nName: ${token.name}`);
}
