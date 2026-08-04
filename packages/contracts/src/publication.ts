import { parseArtifactId, type ArtifactId } from './ids.js';
import { assertDirection, assertLanguage, type Direction } from './language.js';
import { parseSha256Digest } from './digest.js';
import { assertRfc3339, formatRfc3339 } from './time.js';
import type { SiteAccessMode } from './api.js';

/** Current-publication summary copied onto the site row when content exists. */
export type CurrentPublicationSummary = {
  artifact_id: ArtifactId;
  artifact_digest: string;
  root_route: string;
  language: string;
  direction: Direction;
  page_count: number;
  asset_count: number;
  attachment_count: number;
  last_published_at: string;
};

export type SiteStateFixture = {
  id: string;
  slug: string;
  enabled: boolean;
  access_mode: SiteAccessMode;
  content: 'empty' | 'published';
  current_publication: CurrentPublicationSummary | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertNonNegInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

export function parseCurrentPublicationSummary(raw: unknown): CurrentPublicationSummary {
  if (!isPlainObject(raw)) throw new Error('current publication must be an object');
  const artifact_id = parseArtifactId(raw.artifact_id);
  if (!artifact_id) throw new Error('invalid artifact_id');
  const artifact_digest = parseSha256Digest(raw.artifact_digest);
  if (!artifact_digest) throw new Error('invalid artifact_digest');
  if (typeof raw.root_route !== 'string' || !raw.root_route.startsWith('/')) {
    throw new Error('invalid root_route');
  }
  const last = assertRfc3339(raw.last_published_at);
  return {
    artifact_id,
    artifact_digest,
    root_route: raw.root_route,
    language: assertLanguage(raw.language),
    direction: assertDirection(raw.direction),
    page_count: assertNonNegInt(raw.page_count, 'page_count'),
    asset_count: assertNonNegInt(raw.asset_count, 'asset_count'),
    attachment_count: assertNonNegInt(raw.attachment_count, 'attachment_count'),
    last_published_at: formatRfc3339(last),
  };
}

export function assertEmptyOrCompletePublication(
  value: CurrentPublicationSummary | null,
): CurrentPublicationSummary | null {
  return value;
}
