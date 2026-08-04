import { formatSha256Digest, sha256Hex, type SiteId, type TokenRecordId } from '@nrdocs/contracts';
import {
  getAuthoritativeUtcNow,
  getSiteById,
  getTokenByVerifier,
  isTokenUsable,
  touchTokenLastUsed,
  type SiteRow,
  type SqlExecutor,
} from '@nrdocs/persistence';
import { ApiError } from './http.js';
import { PublisherApiErrorCode } from '@nrdocs/contracts';

const TOKEN_RE = /^nrd_pub_[A-Za-z0-9_-]{43}$/;

export type AuthenticatedPublisher = {
  tokenId: TokenRecordId;
  siteId: SiteId;
  site: SiteRow;
  verifier: string;
};

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

/**
 * Authenticate a publishing token. All unusable-token states collapse to invalid_token.
 * Malformed tokens never hit D1.
 */
export async function authenticatePublisher(
  db: SqlExecutor,
  authorization: string | null,
): Promise<AuthenticatedPublisher> {
  const plaintext = extractBearer(authorization);
  if (!plaintext || !TOKEN_RE.test(plaintext)) {
    throw new ApiError(PublisherApiErrorCode.InvalidToken, 'Invalid publishing token.');
  }

  const digest = await sha256Hex(new TextEncoder().encode(plaintext));
  const verifier = formatSha256Digest(digest);
  const token = await getTokenByVerifier(db, verifier);
  const nowIso = await getAuthoritativeUtcNow(db);
  if (!token || !isTokenUsable(token, nowIso)) {
    throw new ApiError(PublisherApiErrorCode.InvalidToken, 'Invalid publishing token.');
  }

  const site = await getSiteById(db, token.site_id);
  if (!site) {
    throw new ApiError(PublisherApiErrorCode.InvalidToken, 'Invalid publishing token.');
  }

  try {
    await touchTokenLastUsed(db, token.id, new Date(Date.parse(nowIso)));
  } catch {
    // best-effort
  }

  return {
    tokenId: token.id,
    siteId: site.id,
    site,
    verifier,
  };
}

export function assertExpectedSite(
  auth: AuthenticatedPublisher,
  expectedHeader: string | null,
  opts: { required: boolean },
): void {
  if (expectedHeader === null || expectedHeader === '') {
    if (opts.required) {
      throw new ApiError(
        PublisherApiErrorCode.InvalidRequest,
        'X-Nrdocs-Expected-Site-ID is required.',
      );
    }
    return;
  }
  if (expectedHeader !== auth.siteId) {
    throw new ApiError(
      PublisherApiErrorCode.SiteMismatch,
      'Publishing token does not authorize the expected site.',
    );
  }
}
