export const READER_CSP =
  "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'";

export const READER_CSP_V2 =
  "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'";

export const AGENT_SHARE_CSP = "default-src 'none'; frame-ancestors 'none'";

export const ATTACHMENT_CSP = "sandbox; default-src 'none'";

export const NO_STORE = 'private, no-store';
export const PLATFORM_CACHE = 'public, max-age=300, must-revalidate';

export function baseSecurityHeaders(opts?: { hsts?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
  };
  if (opts?.hsts) {
    headers['strict-transport-security'] = 'max-age=31536000';
  }
  return headers;
}

export function htmlSecurityHeaders(opts?: {
  hsts?: boolean;
  pageSchema?: 1 | 2;
}): Record<string, string> {
  return {
    ...baseSecurityHeaders(opts),
    'content-security-policy': opts?.pageSchema === 2 ? READER_CSP_V2 : READER_CSP,
    'cache-control': NO_STORE,
    'content-type': 'text/html; charset=utf-8',
  };
}

export function agentContentHeaders(opts?: {
  hsts?: boolean;
  contentType: string;
}): Record<string, string> {
  return {
    'cache-control': NO_STORE,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'content-type': opts?.contentType ?? 'text/plain; charset=utf-8',
    ...(opts?.hsts ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}

export function agentShareJsonHeaders(opts?: { hsts?: boolean }): Record<string, string> {
  return {
    ...agentContentHeaders({ ...opts, contentType: 'application/json; charset=utf-8' }),
    'content-security-policy': AGENT_SHARE_CSP,
  };
}

/** Platform forms POST back to this origin; allow Referer on same-origin submit. */
export function formSecurityHeaders(opts?: { hsts?: boolean }): Record<string, string> {
  return {
    ...htmlSecurityHeaders(opts),
    'referrer-policy': 'same-origin',
  };
}

export function sanitizeAttachmentBasename(filename: string): string {
  let out = '';
  for (const ch of filename) {
    const code = ch.codePointAt(0)!;
    if (
      code < 0x20 ||
      code === 0x7f ||
      ch === '"' ||
      ch === "'" ||
      ch === '/' ||
      ch === '\\' ||
      ch === ':' ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      continue;
    }
    out += ch;
  }
  return out.length > 0 ? out : 'download';
}

export function attachmentContentDisposition(filename: string): string {
  const safe = sanitizeAttachmentBasename(filename);
  const encoded = encodeURIComponent(safe).replace(
    /['()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}
