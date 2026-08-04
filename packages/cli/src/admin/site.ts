import { formatId, parseSlug, type SiteId, type TokenRecordId } from '@nrdocs/contracts';
import {
  beginSiteDeletion,
  changeSitePassword,
  createSiteWithInitialToken,
  finalizeSiteDeletion,
  getSiteBySlug,
  inspectSiteDeletionState,
  listSites,
  listTokensForSite,
  renameSite,
  setSiteAccessPassword,
  setSiteAccessPublic,
  setSiteEnabled,
} from '@nrdocs/persistence';
import type { CommandContext } from '../command-context.js';
import { parseFlags } from '../argv.js';
import { localValidationError, usageError } from '../errors.js';
import { presentHumanSuccess, presentJsonSuccess } from '../present.js';
import { confirmOrDecline, confirmPhraseOrDecline } from '../terminal.js';
import { beginAdminSession, purgeSiteArtifacts, type AdminOptions } from './context.js';
import { derivePasswordVerifier, generatePublishingToken, assertReaderPassword } from './crypto.js';

function siteUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/${slug}/`;
}

async function promptAccessMode(ctx: CommandContext): Promise<'public' | 'password'> {
  const answer = (await ctx.terminal.promptLine('Reader access [public/password]:'))
    .trim()
    .toLowerCase();
  if (answer === 'public' || answer === 'p' || answer === '') return 'public';
  if (answer === 'password' || answer === 'password protected') return 'password';
  throw usageError('Reader access must be public or password.');
}

async function promptNewPassword(ctx: CommandContext): Promise<string> {
  const a = await ctx.terminal.promptMasked('Reader password:');
  const b = await ctx.terminal.promptMasked('Confirm reader password:');
  if (a !== b) throw localValidationError('Reader passwords do not match.');
  try {
    assertReaderPassword(a);
  } catch (error) {
    throw localValidationError(error instanceof Error ? error.message : 'Invalid reader password.');
  }
  return a;
}

export async function runSiteCommand(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions = {},
): Promise<void> {
  const sub = args[0];
  if (ctx.help || !sub) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'nrdocs site create <slug>',
        'nrdocs site list',
        'nrdocs site show <slug>',
        'nrdocs site access <slug> public|password',
        'nrdocs site password change <slug>',
        'nrdocs site enable <slug>',
        'nrdocs site disable <slug>',
        'nrdocs site rename <old-slug> <new-slug>',
        'nrdocs site delete <slug>',
      ].join('\n') + '\n',
    );
    return;
  }

  if (sub === 'password' && args[1] === 'change') {
    await sitePasswordChange(ctx, args.slice(2), options);
    return;
  }

  switch (sub) {
    case 'create':
      await siteCreate(ctx, args.slice(1), options);
      return;
    case 'list':
      await siteList(ctx, args.slice(1), options);
      return;
    case 'show':
      await siteShow(ctx, args.slice(1), options);
      return;
    case 'access':
      await siteAccess(ctx, args.slice(1), options);
      return;
    case 'enable':
      await siteEnable(ctx, args.slice(1), true, options);
      return;
    case 'disable':
      await siteEnable(ctx, args.slice(1), false, options);
      return;
    case 'rename':
      await siteRename(ctx, args.slice(1), options);
      return;
    case 'delete':
      await siteDelete(ctx, args.slice(1), options);
      return;
    default:
      throw usageError(`Unknown site command: ${sub}`, 'Run: nrdocs site --help');
  }
}

async function siteCreate(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) throw usageError('site create requires exactly one slug.');
  const slug = parseSlug(positionals[0]);
  if (!slug) throw usageError('Invalid or reserved site slug.');

  const session = await beginAdminSession(ctx, 'site create', options, { mutating: true });
  presentHumanSuccess(ctx.runtime, `Slug:     ${slug}`);

  const access = await promptAccessMode(ctx);
  let password_verifier: string | null = null;
  if (access === 'password') {
    const password = await promptNewPassword(ctx);
    password_verifier = await derivePasswordVerifier(password);
  }

  const tokenNameRaw = await ctx.terminal.promptLine('Initial publishing token name [initial]:');
  const tokenName = (tokenNameRaw.trim() || 'initial').trim();
  const siteId = formatId('site', globalThis.crypto.getRandomValues(new Uint8Array(16))) as SiteId;
  const tokenId = formatId(
    'tok',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as TokenRecordId;
  const { plaintext, verifier } = await generatePublishingToken();

  try {
    await createSiteWithInitialToken(session.db, {
      id: siteId,
      slug,
      access_mode: access,
      password_verifier,
      initialToken: {
        id: tokenId,
        name: tokenName,
        token_verifier: verifier,
      },
    });
  } catch (error) {
    throw localValidationError(error instanceof Error ? error.message : 'site create failed');
  }

  presentHumanSuccess(
    ctx.runtime,
    [
      'Site created.',
      '',
      `URL:      ${siteUrl(session.descriptor.canonical_origin, slug)}`,
      `Site ID:  ${siteId}`,
      `Access:   ${access}`,
      '',
      `Publishing token: ${plaintext}`,
      '',
      'This token will not be displayed again.',
    ].join('\n'),
  );
}

async function siteList(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length > 0) throw usageError('site list takes no arguments.');
  const session = await beginAdminSession(ctx, 'site list', options, { mutating: false });
  const sites = await listSites(session.db);
  const rows = [];
  for (const site of sites) {
    const tokens = await listTokensForSite(session.db, site.id);
    rows.push({
      slug: site.slug,
      site_id: site.id,
      enabled: site.enabled,
      access_mode: site.access_mode,
      content: site.current_artifact_id ? 'published' : 'empty',
      token_count: tokens.length,
      last_published_at: site.last_published_at,
      url: siteUrl(session.descriptor.canonical_origin, site.slug),
    });
  }
  if (ctx.json) {
    presentJsonSuccess(ctx.runtime, rows);
    return;
  }
  if (rows.length === 0) {
    presentHumanSuccess(ctx.runtime, 'No sites.');
    return;
  }
  const lines = ['Sites:', ''];
  for (const row of rows) {
    lines.push(`  ${row.slug}`);
    lines.push(`    id:       ${row.site_id}`);
    lines.push(`    enabled:  ${row.enabled ? 'yes' : 'no'}`);
    lines.push(`    access:   ${row.access_mode}`);
    lines.push(`    content:  ${row.content}`);
    lines.push(`    tokens:   ${row.token_count}`);
    lines.push(`    url:      ${row.url}`);
  }
  presentHumanSuccess(ctx.runtime, lines.join('\n'));
}

async function siteShow(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) throw usageError('site show requires exactly one slug.');
  const session = await beginAdminSession(ctx, 'site show', options, { mutating: false });
  const site = await getSiteBySlug(session.db, positionals[0]!);
  if (!site) throw localValidationError(`No site with slug:\n  ${positionals[0]}`);
  const tokens = await listTokensForSite(session.db, site.id);
  const data = {
    slug: site.slug,
    site_id: site.id,
    enabled: site.enabled,
    access_mode: site.access_mode,
    content: site.current_artifact_id ? 'published' : 'empty',
    session_generation: site.session_generation,
    token_count: tokens.length,
    last_published_at: site.last_published_at,
    current_language: site.current_language,
    current_direction: site.current_direction,
    url: siteUrl(session.descriptor.canonical_origin, site.slug),
  };
  if (ctx.json) {
    presentJsonSuccess(ctx.runtime, data);
    return;
  }
  presentHumanSuccess(
    ctx.runtime,
    [
      `Slug:       ${data.slug}`,
      `Site ID:    ${data.site_id}`,
      `URL:        ${data.url}`,
      `Enabled:    ${data.enabled ? 'yes' : 'no'}`,
      `Access:     ${data.access_mode}`,
      `Content:    ${data.content}`,
      `Tokens:     ${data.token_count}`,
      `Published:  ${data.last_published_at ?? '(none)'}`,
    ].join('\n'),
  );
}

async function siteAccess(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 2) {
    throw usageError('site access requires <slug> public|password.');
  }
  const [slugArg, mode] = positionals;
  if (mode !== 'public' && mode !== 'password') {
    throw usageError('site access mode must be public or password.');
  }
  const session = await beginAdminSession(ctx, 'site access', options, { mutating: true });
  const site = await getSiteBySlug(session.db, slugArg!);
  if (!site) throw localValidationError(`No site with slug:\n  ${slugArg}`);

  if (mode === 'public') {
    if (site.access_mode === 'public') {
      presentHumanSuccess(ctx.runtime, 'unchanged');
      return;
    }
    presentHumanSuccess(
      ctx.runtime,
      'This will make the site public and permanently remove the password verifier.',
    );
    if ((await confirmOrDecline(ctx.terminal, 'Make site public?')) === 'declined') {
      presentHumanSuccess(ctx.runtime, 'Cancelled.');
      return;
    }
    await setSiteAccessPublic(session.db, site.id);
    presentHumanSuccess(ctx.runtime, `Access updated.\nSite:   ${site.slug}\nAccess: public`);
    return;
  }

  if (site.access_mode === 'password') {
    throw localValidationError(
      'Site is already password-protected.\nUse: nrdocs site password change <slug>',
    );
  }
  const password = await promptNewPassword(ctx);
  const verifier = await derivePasswordVerifier(password);
  await setSiteAccessPassword(session.db, site.id, verifier);
  presentHumanSuccess(ctx.runtime, `Access updated.\nSite:   ${site.slug}\nAccess: password`);
}

async function sitePasswordChange(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) throw usageError('site password change requires exactly one slug.');
  const session = await beginAdminSession(ctx, 'site password change', options, { mutating: true });
  const site = await getSiteBySlug(session.db, positionals[0]!);
  if (!site) throw localValidationError(`No site with slug:\n  ${positionals[0]}`);
  if (site.access_mode !== 'password') {
    throw localValidationError('site password change is only valid for password-protected sites.');
  }
  const password = await promptNewPassword(ctx);
  const verifier = await derivePasswordVerifier(password);
  await changeSitePassword(session.db, site.id, verifier);
  presentHumanSuccess(ctx.runtime, `Password changed.\nSite: ${site.slug}`);
}

async function siteEnable(
  ctx: CommandContext,
  args: readonly string[],
  enabled: boolean,
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) {
    throw usageError(`site ${enabled ? 'enable' : 'disable'} requires exactly one slug.`);
  }
  const session = await beginAdminSession(ctx, enabled ? 'site enable' : 'site disable', options, {
    mutating: true,
  });
  const site = await getSiteBySlug(session.db, positionals[0]!);
  if (!site) throw localValidationError(`No site with slug:\n  ${positionals[0]}`);
  if (site.enabled === enabled) {
    presentHumanSuccess(ctx.runtime, 'unchanged');
    return;
  }
  await setSiteEnabled(session.db, site.id, enabled);
  presentHumanSuccess(ctx.runtime, `Site ${enabled ? 'enabled' : 'disabled'}.\nSlug: ${site.slug}`);
}

async function siteRename(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 2) {
    throw usageError('site rename requires <old-slug> <new-slug>.');
  }
  const [oldSlug, newSlugRaw] = positionals;
  const newSlug = parseSlug(newSlugRaw);
  if (!newSlug) throw usageError('Invalid or reserved new slug.');
  const session = await beginAdminSession(ctx, 'site rename', options, { mutating: true });
  const site = await getSiteBySlug(session.db, oldSlug!);
  if (!site) throw localValidationError(`No site with slug:\n  ${oldSlug}`);
  const oldUrl = siteUrl(session.descriptor.canonical_origin, site.slug);
  const newUrl = siteUrl(session.descriptor.canonical_origin, newSlug);
  presentHumanSuccess(
    ctx.runtime,
    [
      `Current URL: ${oldUrl}`,
      `New URL:     ${newUrl}`,
      '',
      'The previous URL will return 404 immediately. No redirect is created.',
    ].join('\n'),
  );
  if ((await confirmOrDecline(ctx.terminal, 'Rename site?')) === 'declined') {
    presentHumanSuccess(ctx.runtime, 'Cancelled.');
    return;
  }
  try {
    await renameSite(session.db, site.id, newSlug);
  } catch (error) {
    throw localValidationError(error instanceof Error ? error.message : 'rename failed');
  }
  presentHumanSuccess(ctx.runtime, `Site renamed.\nURL: ${newUrl}`);
}

async function siteDelete(
  ctx: CommandContext,
  args: readonly string[],
  options: AdminOptions,
): Promise<void> {
  const { positionals } = parseFlags(args);
  if (positionals.length !== 1) throw usageError('site delete requires exactly one slug.');
  const session = await beginAdminSession(ctx, 'site delete', options, { mutating: true });
  const site = await getSiteBySlug(session.db, positionals[0]!);
  if (!site) throw localValidationError(`No site with slug:\n  ${positionals[0]}`);

  presentHumanSuccess(
    ctx.runtime,
    [
      'This permanently deletes:',
      `  site ${site.slug}`,
      '  current publication artifacts',
      '  password verifier (if any)',
      '  all publishing tokens',
      '  site metadata',
      '',
      'There is no recovery.',
    ].join('\n'),
  );
  if (
    (await confirmPhraseOrDecline(
      ctx.terminal,
      `Type the slug to confirm (${site.slug}):`,
      site.slug,
    )) === 'declined'
  ) {
    presentHumanSuccess(ctx.runtime, 'Cancelled.');
    return;
  }

  await beginSiteDeletion(session.db, site.id);
  // Wait out active lock if present (tests use expired/absent locks).
  for (let i = 0; i < 5; i++) {
    const state = await inspectSiteDeletionState(session.db, site.id);
    if (state.readyForFinalDelete) break;
    if (!state.lockActive) break;
  }
  const purged = await purgeSiteArtifacts(session.store, site.id);
  if (!purged.empty) {
    presentHumanSuccess(
      ctx.runtime,
      [
        'Site disabled and tokens revoked, but R2 deletion is incomplete.',
        '',
        `Resume with:\n  nrdocs site delete ${site.slug}`,
      ].join('\n'),
    );
    throw localValidationError('R2 site prefix was not fully deleted.');
  }
  const finalized = await finalizeSiteDeletion(session.db, site.id);
  if (!finalized) {
    throw localValidationError(
      'Could not finalize site deletion (lock still active or site state incomplete).',
    );
  }
  presentHumanSuccess(ctx.runtime, `Site deleted.\nSlug: ${site.slug}`);
}
