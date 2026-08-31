/** Authoritative publication limits from 07-security-and-resource-limits.md. */

export const LIMITS = {
  compressedMaxBytes: 25 * 1024 * 1024,
  uncompressedMaxBytes: 100 * 1024 * 1024,
  maxExpansionRatio: 20,
  manifestMaxBytes: 1 * 1024 * 1024,
  maxDeclaredFiles: 1000,
  maxDeclaredFilesWithOpenApi: 1600,
  maxPages: 500,
  maxAssets: 500,
  maxAttachments: 200,
  maxPageHtmlBytes: 2 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxMermaidBlocksPerPage: 50,
  maxMermaidSourceBytes: 64 * 1024,
  maxArchivePathBytes: 512,
  maxArchiveSegmentBytes: 128,
  maxAttachmentFilenameScalars: 160,
  maxAttachmentFilenameBytes: 255,
  requestDeadlineMs: 5 * 60 * 1000,
} as const;

export const RATE_LIMITS = {
  invalidCredentialsPerIp: { limit: 30, windowMs: 60_000 },
  resolveTargetPerToken: { limit: 120, windowMs: 60_000 },
  publishPerSiteToken: { limit: 10, windowMs: 60_000 },
  apiPerInstance: { limit: 300, windowMs: 60_000 },
  passwordPerSiteIp: { limit: 10, windowMs: 60_000 },
  passwordPerSite: { limit: 100, windowMs: 60_000 },
  agentSharePerSiteIp: { limit: 20, windowMs: 60_000 },
  agentSharePerInstance: { limit: 200, windowMs: 60_000 },
  retryAfterSeconds: 60,
} as const;

export const PLATFORM_ASSETS = Object.freeze([
  '/_nrdocs/v1/reader.css',
  '/_nrdocs/v1/reader.js',
  '/_nrdocs/v1/mermaid.js',
  '/_nrdocs/v1/logo.svg',
] as const);

export const PLATFORM_ASSETS_V2 = Object.freeze([
  '/_nrdocs/v2/reader.css',
  '/_nrdocs/v2/reader.js',
  '/_nrdocs/v2/mermaid.js',
  '/_nrdocs/v2/logo.svg',
] as const);

export const PLATFORM_ASSETS_V3 = Object.freeze([
  '/_nrdocs/v3/reader.css',
  '/_nrdocs/v3/reader.js',
  '/_nrdocs/v3/mermaid.js',
  '/_nrdocs/v3/logo.svg',
] as const);

export const MAX_PAGES_WITH_OPENAPI = 800;
