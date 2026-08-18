import { escapeHtml } from './escape.js';
import { htmlSecurityHeaders } from './headers.js';

export type PlatformLang = { language: string; direction: string };

export const NRDOCS_GITHUB_HREF = 'https://github.com/noam-r/nrdocs' as const;

function shell(opts: { lang: PlatformLang; title: string; body: string }): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(opts.lang.language)}" dir="${escapeHtml(opts.lang.direction)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    `  <title>${escapeHtml(opts.title)}</title>`,
    '  <link rel="icon" href="/_nrdocs/v1/logo.svg" type="image/svg+xml">',
    '  <link rel="stylesheet" href="/_nrdocs/v1/reader.css">',
    '</head>',
    '<body class="nr-platform">',
    opts.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function platformCard(inner: readonly string[]): string {
  return [
    '  <main class="nr-platform-main">',
    '    <div class="nr-platform-card">',
    '      <p class="nr-platform-brand" aria-label="nrdocs"></p>',
    ...inner.map((line) => `      ${line}`),
    `      <p class="nr-platform-footer"><a href="${NRDOCS_GITHUB_HREF}">nrdocs on GitHub</a></p>`,
    '    </div>',
    '  </main>',
  ].join('\n');
}

export function instanceRootPage(): string {
  return shell({
    lang: { language: 'und', direction: 'auto' },
    title: 'nrdocs',
    body: platformCard([
      '<h1>nrdocs</h1>',
      '<p class="nr-platform-lead">Publish a Markdown directory as a protected website.</p>',
    ]),
  });
}

export function notFoundPage(lang: PlatformLang = { language: 'und', direction: 'auto' }): string {
  return shell({
    lang,
    title: 'Not found',
    body: platformCard([
      '<h1>Not found</h1>',
      '<p>The requested page is unavailable.</p>',
      '<p><a href="/">Instance home</a></p>',
    ]),
  });
}

export function unavailablePage(
  requestId: string,
  lang: PlatformLang = { language: 'und', direction: 'auto' },
): string {
  return shell({
    lang,
    title: 'Site temporarily unavailable',
    body: platformCard([
      '<h1>Site temporarily unavailable</h1>',
      '<p>Try again later.</p>',
      `<p class="nr-request-id">${escapeHtml(requestId)}</p>`,
    ]),
  });
}

export function passwordFormPage(input: {
  lang: PlatformLang;
  slug: string;
  returnPath: string;
  csrf: string;
  wrong?: boolean;
}): string {
  const message = input.wrong
    ? 'The password is incorrect. Try again.'
    : 'Enter the password to continue.';
  const messageClass = input.wrong ? 'nr-platform-error' : 'nr-platform-lead';
  return shell({
    lang: input.lang,
    title: 'Password required',
    body: platformCard([
      '<h1>Password required</h1>',
      `<p class="${messageClass}">${escapeHtml(message)}</p>`,
      '<form method="post" action="/_nrdocs/access">',
      `  <input type="hidden" name="site" value="${escapeHtml(input.slug)}">`,
      `  <input type="hidden" name="return" value="${escapeHtml(input.returnPath)}">`,
      `  <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">`,
      '  <label for="nr-password">Password</label>',
      '  <input id="nr-password" name="password" type="password" autocomplete="current-password" required autofocus>',
      '  <button type="submit">Continue</button>',
      '</form>',
    ]),
  });
}

export function logoutFormPage(input: { lang: PlatformLang; slug: string; csrf: string }): string {
  return shell({
    lang: input.lang,
    title: 'Sign out',
    body: platformCard([
      '<h1>Sign out</h1>',
      '<p>End your session for this site.</p>',
      '<form method="post" action="/_nrdocs/logout">',
      `  <input type="hidden" name="site" value="${escapeHtml(input.slug)}">`,
      `  <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">`,
      '  <button type="submit">Sign out</button>',
      '</form>',
    ]),
  });
}

export function logoutPage(input: { lang: PlatformLang; slug: string }): string {
  return shell({
    lang: input.lang,
    title: 'You have been signed out.',
    body: platformCard([
      '<h1>You have been signed out.</h1>',
      `<p><a href="/${escapeHtml(input.slug)}/">Return to site.</a></p>`,
    ]),
  });
}

export function htmlResponse(
  body: string,
  status: number,
  opts?: { hsts?: boolean; setCookie?: string; headers?: Record<string, string> },
): Response {
  const headers = new Headers(htmlSecurityHeaders(opts));
  if (opts?.setCookie) headers.append('set-cookie', opts.setCookie);
  if (opts?.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v);
  }
  return new Response(body, { status, headers });
}

export function headOf(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers });
}
