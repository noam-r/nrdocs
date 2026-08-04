import { parseRequestId, parseSiteId, type RequestId, type SiteId } from './ids.js';
import { parseSlug } from './slug.js';
import {
  exitCodeForPublisherApiError,
  PublisherApiErrorCode,
  type ExitCode,
  type PublisherApiErrorCode as ApiErrorCode,
} from './exit-codes.js';

export type SiteAccessMode = 'public' | 'password';
export type SiteContentState = 'empty' | 'published';

export type PublishTargetSite = {
  id: SiteId;
  slug: string;
  url: string;
  enabled: boolean;
  access: SiteAccessMode;
  content: SiteContentState;
};

export type PublishResultSite = {
  id: SiteId;
  slug: string;
  url: string;
  enabled: boolean;
  access: SiteAccessMode;
};

export type PublicationResult = 'published' | 'unchanged';

export type PublishResultData = {
  site: PublishResultSite;
  publication: {
    result: PublicationResult;
    pages: number;
    assets: number;
    attachments: number;
  };
};

export type PublishTargetData = {
  site: PublishTargetSite;
};

export type ProtocolVersionData = {
  product: 'nrdocs';
  package_version: string;
  api_versions: number[];
  artifact_schema_versions: number[];
};

export type ApiSuccessEnvelope<T> = {
  ok: true;
  data: T;
  request_id: RequestId;
};

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
};

export type ApiErrorEnvelope = {
  ok: false;
  error: ApiErrorBody;
  request_id: RequestId;
};

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertRequestId(value: unknown): RequestId {
  const id = parseRequestId(value);
  if (!id) throw new Error('invalid request_id');
  return id;
}

function assertNonNegInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function parseAccess(value: unknown): SiteAccessMode {
  if (value === 'public' || value === 'password') return value;
  throw new Error('invalid site access');
}

function parseSiteUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid site url');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid site url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('invalid site url protocol');
  }
  if (!url.pathname.endsWith('/')) throw new Error('site url must end with /');
  return value;
}

function parsePublishResultSite(raw: unknown): PublishResultSite {
  if (!isPlainObject(raw)) throw new Error('site must be an object');
  for (const key of Object.keys(raw)) {
    if (!['id', 'slug', 'url', 'enabled', 'access'].includes(key)) {
      throw new Error(`unknown site field: ${key}`);
    }
  }
  const id = parseSiteId(raw.id);
  if (!id) throw new Error('invalid site id');
  const slug = parseSlug(raw.slug);
  if (!slug) throw new Error('invalid site slug');
  if (typeof raw.enabled !== 'boolean') throw new Error('enabled must be boolean');
  return {
    id,
    slug,
    url: parseSiteUrl(raw.url),
    enabled: raw.enabled,
    access: parseAccess(raw.access),
  };
}

function parsePublishTargetSite(raw: unknown): PublishTargetSite {
  if (!isPlainObject(raw)) throw new Error('site must be an object');
  for (const key of Object.keys(raw)) {
    if (!['id', 'slug', 'url', 'enabled', 'access', 'content'].includes(key)) {
      throw new Error(`unknown site field: ${key}`);
    }
  }
  const id = parseSiteId(raw.id);
  if (!id) throw new Error('invalid site id');
  const slug = parseSlug(raw.slug);
  if (!slug) throw new Error('invalid site slug');
  if (typeof raw.enabled !== 'boolean') throw new Error('enabled must be boolean');
  const content = raw.content;
  if (content !== 'empty' && content !== 'published') throw new Error('invalid site content');
  return {
    id,
    slug,
    url: parseSiteUrl(raw.url),
    enabled: raw.enabled,
    access: parseAccess(raw.access),
    content,
  };
}

export function parseProtocolVersionData(raw: unknown): ProtocolVersionData {
  if (!isPlainObject(raw)) throw new Error('version data must be an object');
  if (raw.product !== 'nrdocs') throw new Error('product must be nrdocs');
  if (typeof raw.package_version !== 'string' || !raw.package_version) {
    throw new Error('invalid package_version');
  }
  if (!Array.isArray(raw.api_versions) || !raw.api_versions.every((v) => Number.isInteger(v))) {
    throw new Error('invalid api_versions');
  }
  if (
    !Array.isArray(raw.artifact_schema_versions) ||
    !raw.artifact_schema_versions.every((v) => Number.isInteger(v))
  ) {
    throw new Error('invalid artifact_schema_versions');
  }
  return {
    product: 'nrdocs',
    package_version: raw.package_version,
    api_versions: raw.api_versions as number[],
    artifact_schema_versions: raw.artifact_schema_versions as number[],
  };
}

export function parsePublishTargetData(raw: unknown): PublishTargetData {
  if (!isPlainObject(raw)) throw new Error('publish-target data must be an object');
  for (const key of Object.keys(raw)) {
    if (key !== 'site') throw new Error(`unknown publish-target field: ${key}`);
  }
  return { site: parsePublishTargetSite(raw.site) };
}

export function parsePublishResultData(raw: unknown): PublishResultData {
  if (!isPlainObject(raw)) throw new Error('publish data must be an object');
  for (const key of Object.keys(raw)) {
    if (key !== 'site' && key !== 'publication') {
      throw new Error(`unknown publish field: ${key}`);
    }
  }
  if (!isPlainObject(raw.publication)) throw new Error('publication must be an object');
  for (const key of Object.keys(raw.publication)) {
    if (!['result', 'pages', 'assets', 'attachments'].includes(key)) {
      throw new Error(`unknown publication field: ${key}`);
    }
  }
  const result = raw.publication.result;
  if (result !== 'published' && result !== 'unchanged') {
    throw new Error('invalid publication result');
  }
  return {
    site: parsePublishResultSite(raw.site),
    publication: {
      result,
      pages: assertNonNegInt(raw.publication.pages, 'pages'),
      assets: assertNonNegInt(raw.publication.assets, 'assets'),
      attachments: assertNonNegInt(raw.publication.attachments, 'attachments'),
    },
  };
}

export function parseApiSuccessEnvelope<T>(
  raw: unknown,
  parseData: (data: unknown) => T,
): ApiSuccessEnvelope<T> {
  if (!isPlainObject(raw)) throw new Error('envelope must be an object');
  if (raw.ok !== true) throw new Error('expected ok:true');
  for (const key of Object.keys(raw)) {
    if (!['ok', 'data', 'request_id'].includes(key)) {
      throw new Error(`unknown success envelope field: ${key}`);
    }
  }
  return {
    ok: true,
    data: parseData(raw.data),
    request_id: assertRequestId(raw.request_id),
  };
}

export function parseApiErrorEnvelope(raw: unknown): ApiErrorEnvelope {
  if (!isPlainObject(raw)) throw new Error('envelope must be an object');
  if (raw.ok !== false) throw new Error('expected ok:false');
  for (const key of Object.keys(raw)) {
    if (!['ok', 'error', 'request_id'].includes(key)) {
      throw new Error(`unknown error envelope field: ${key}`);
    }
  }
  if (!isPlainObject(raw.error)) throw new Error('error must be an object');
  for (const key of Object.keys(raw.error)) {
    if (key !== 'code' && key !== 'message') {
      throw new Error(`unknown error field: ${key}`);
    }
  }
  const code = raw.error.code;
  if (!isApiErrorCode(code)) throw new Error('unknown API error code');
  if (typeof raw.error.message !== 'string' || !raw.error.message) {
    throw new Error('error message required');
  }
  if (/nrd_pub_|Bearer\s/i.test(raw.error.message)) {
    throw new Error('error message must not contain secrets');
  }
  return {
    ok: false,
    error: { code, message: raw.error.message },
    request_id: assertRequestId(raw.request_id),
  };
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === 'string' && (Object.values(PublisherApiErrorCode) as string[]).includes(value)
  );
}

export function exitCodeForApiErrorEnvelope(envelope: ApiErrorEnvelope): ExitCode {
  return exitCodeForPublisherApiError(envelope.error.code);
}

export const PUBLISHER_HEADERS = {
  expectedSiteId: 'X-Nrdocs-Expected-Site-ID',
  artifactDigest: 'X-Nrdocs-Artifact-Digest',
  requestId: 'X-Nrdocs-Request-ID',
} as const;

export const ARTIFACT_CONTENT_TYPE = 'application/vnd.nrdocs.artifact+gzip; version=1';
