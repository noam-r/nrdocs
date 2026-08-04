import { escapeHtml } from './escape.js';
import { htmlSecurityHeaders } from './headers.js';

export type PlatformLang = { language: string; direction: string };

function shell(opts: { lang: PlatformLang; title: string; body: string }): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(opts.lang.language)}" dir="${escapeHtml(opts.lang.direction)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width,initial-scale=1">',
    `  <title>${escapeHtml(opts.title)}</title>`,
    '  <link rel="stylesheet" href="/_nrdocs/v1/reader.css">',
    '</head>',
    '<body class="nr-platform">',
    opts.body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function instanceRootPage(): string {
  return shell({
    lang: { language: 'und', direction: 'auto' },
    title: 'nrdocs',
    body: [
      '  <main class="nr-platform-main">',
      '    <h1>nrdocs</h1>',
      '    <p>This nrdocs instance serves sites at their direct URLs.</p>',
      '  </main>',
    ].join('\n'),
  });
}

export function notFoundPage(lang: PlatformLang = { language: 'und', direction: 'auto' }): string {
  return shell({
    lang,
    title: 'Not found',
    body: [
      '  <main class="nr-platform-main">',
      '    <h1>Not found</h1>',
      '    <p>The requested page is unavailable.</p>',
      '  </main>',
    ].join('\n'),
  });
}

export function unavailablePage(
  requestId: string,
  lang: PlatformLang = { language: 'und', direction: 'auto' },
): string {
  return shell({
    lang,
    title: 'Site temporarily unavailable',
    body: [
      '  <main class="nr-platform-main">',
      '    <h1>Site temporarily unavailable</h1>',
      '    <p>Try again later.</p>',
      `    <p class="nr-request-id">${escapeHtml(requestId)}</p>`,
      '  </main>',
    ].join('\n'),
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
  return shell({
    lang: input.lang,
    title: 'Password required',
    body: [
      '  <main class="nr-platform-main">',
      '    <h1>Password required</h1>',
      `    <p>${escapeHtml(message)}</p>`,
      '    <form method="post" action="/_nrdocs/access">',
      `      <input type="hidden" name="site" value="${escapeHtml(input.slug)}">`,
      `      <input type="hidden" name="return" value="${escapeHtml(input.returnPath)}">`,
      `      <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">`,
      '      <label for="nr-password">Password</label>',
      '      <input id="nr-password" name="password" type="password" autocomplete="current-password" required>',
      '      <button type="submit">Continue</button>',
      '    </form>',
      '  </main>',
    ].join('\n'),
  });
}

export function logoutPage(input: { lang: PlatformLang; slug: string }): string {
  return shell({
    lang: input.lang,
    title: 'You have been signed out.',
    body: [
      '  <main class="nr-platform-main">',
      '    <h1>You have been signed out.</h1>',
      `    <p><a href="/${escapeHtml(input.slug)}/">Return to site.</a></p>`,
      '  </main>',
    ].join('\n'),
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
