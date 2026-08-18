import { formatId, type SiteId, type TokenRecordId } from '@nrdocs/contracts';
import {
  createSiteWithInitialToken,
  getSiteBySlug,
  listSites,
  type SiteRow,
} from '@nrdocs/persistence';
import type { CommandContext } from '../command-context.js';
import type { NrdocsConfig } from '@nrdocs/contracts';
import { localValidationError, usageError } from '../errors.js';
import { presentHumanSuccess } from '../present.js';
import { requireInteractiveTerminal } from '../terminal.js';
import { resolvePublicationTitle, writeConnectedNrdocsYml } from '../publication-config.js';
import { generatePublishingToken, derivePasswordVerifier } from './crypto.js';
import { promptAccessMode, promptNewPassword, siteAlreadyExistsError, siteUrl } from './site.js';
import { requireSiteSlug } from './slug.js';
import type { AdminSession } from './context.js';

function describeSite(origin: string, site: SiteRow): string {
  return `${site.slug}  ${siteUrl(origin, site.slug)}`;
}

async function createSiteForPublish(ctx: CommandContext, session: AdminSession): Promise<SiteRow> {
  const slugRaw = await ctx.terminal.promptLine('Site slug [lowercase, digits, hyphens]:');
  const slug = requireSiteSlug(slugRaw);
  const existing = await getSiteBySlug(session.db, slug);
  if (existing) throw siteAlreadyExistsError(session.descriptor.canonical_origin, existing);

  const access = await promptAccessMode(ctx);
  let password_verifier: string | null = null;
  if (access === 'password') {
    const password = await promptNewPassword(ctx);
    password_verifier = await derivePasswordVerifier(password);
  }

  const siteId = formatId('site', globalThis.crypto.getRandomValues(new Uint8Array(16))) as SiteId;
  const tokenId = formatId(
    'tok',
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
  ) as TokenRecordId;
  const { verifier } = await generatePublishingToken();

  try {
    const created = await createSiteWithInitialToken(session.db, {
      id: siteId,
      slug,
      access_mode: access,
      password_verifier,
      initialToken: {
        id: tokenId,
        name: 'initial',
        token_verifier: verifier,
      },
    });
    return created.site;
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (/already exists/i.test(msg) || /UNIQUE|SQLITE_CONSTRAINT/i.test(msg)) {
      throw localValidationError(`A site with slug "${slug}" already exists.`);
    }
    throw localValidationError(error instanceof Error ? error.message : 'site create failed');
  }
}

async function pickExistingSite(
  ctx: CommandContext,
  origin: string,
  sites: SiteRow[],
  pickerHeading: string,
): Promise<SiteRow> {
  if (sites.length === 1) {
    return sites[0]!;
  }

  const lines = [pickerHeading, ''];
  sites.forEach((site, index) => {
    lines.push(`  ${index + 1}. ${describeSite(origin, site)}`);
  });
  presentHumanSuccess(ctx.runtime, lines.join('\n'));

  const raw = (await ctx.terminal.promptLine('Site number:')).trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > sites.length) {
    throw usageError('Choose a site by number from the list.');
  }
  return sites[n - 1]!;
}

/** Bind an unbound directory to a site on the local administrative instance. */
export async function bindDirectoryOnAdminInstance(
  ctx: CommandContext,
  input: {
    session: AdminSession;
    root: string;
    existing: NrdocsConfig | null;
    titleFlag: string | undefined;
    mode?: 'connect' | 'publish';
  },
): Promise<{ siteId: SiteId; config: NrdocsConfig }> {
  const mode = input.mode ?? 'publish';
  requireInteractiveTerminal(ctx.runtime, mode === 'connect' ? 'nrdocs connect' : 'nrdocs publish');
  const origin = input.session.descriptor.canonical_origin;
  presentHumanSuccess(
    ctx.runtime,
    `Instance: ${origin}\nID:       ${input.session.descriptor.instance_id}`,
  );

  const sites = await listSites(input.session.db);
  const site =
    sites.length === 0
      ? await createSiteForPublish(ctx, input.session)
      : await pickExistingSite(
          ctx,
          origin,
          sites,
          mode === 'connect' ? 'Connect to which site?' : 'Publish to which site?',
        );

  presentHumanSuccess(
    ctx.runtime,
    `${mode === 'connect' ? 'Connected to' : 'Publishing to'}:\n  ${site.slug}\n  ${siteUrl(origin, site.slug)}`,
  );

  const title = await resolvePublicationTitle({
    existing: input.existing,
    titleFlag: input.titleFlag,
    interactive: true,
    prompt: async () => ctx.terminal.promptLine('Site title:'),
  });

  const config = await writeConnectedNrdocsYml(ctx, input.root, {
    existing: input.existing,
    siteId: site.id,
    title,
  });
  return { siteId: site.id, config };
}
