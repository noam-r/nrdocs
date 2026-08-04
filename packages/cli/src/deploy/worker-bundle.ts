/**
 * Minimal Phase 7+ Worker module bundled into the CLI package for deploy smoke.
 * Full publisher API lives in @nrdocs/worker; deploy packaging of the complete
 * Worker module is refined as the Worker surface stabilizes.
 */
export const BUNDLED_WORKER_MODULE = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/_nrdocs/api/version') {
      return Response.json({
        product: 'nrdocs',
        package_version: env.NRDOCS_PACKAGE_VERSION,
        api_versions: [1],
        artifact_schema_versions: [1],
      }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('nrdocs', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
};
`;

export const BUNDLED_PLATFORM_CSS = `/* nrdocs platform reader.css v1 */\n`;
export const BUNDLED_PLATFORM_JS = `/* nrdocs platform reader.js v1 */\n`;
