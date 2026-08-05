import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTIFACT_CONTENT_TYPE,
  formatId,
  formatSha256Digest,
  parseNrdocsConfig,
  PUBLISHER_HEADERS,
  sha256Hex,
  type InstanceId,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  applyMigrations,
  changeSitePassword,
  createSiteWithInitialToken,
  getSiteById,
  insertInstanceMetadata,
  MemoryArtifactStore,
  renameSite,
  setSiteAccessPassword,
  setSiteAccessPublic,
  setSiteEnabled,
  sqliteAsD1Database,
} from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { buildArtifactFromConfig } from '@nrdocs/renderer';
import { handleRequest, type WorkerEnv } from './index.js';
import { MemoryRateLimiter } from './rate-limit.js';
import { bytesToBase64Url } from './reader/crypto.js';
import { validateSafeReturnPath } from './reader/return-path.js';
import { sessionCookieName } from './reader/session.js';

const INST = formatId('inst', new Uint8Array(16).fill(1)) as InstanceId;
const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const SITE_B = formatId('site', new Uint8Array(16).fill(4)) as SiteId;
const TOK = formatId('tok', new Uint8Array(16).fill(3)) as TokenRecordId;
const TOK_B = formatId('tok', new Uint8Array(16).fill(5)) as TokenRecordId;
const SESSION_KEY = new Uint8Array(32).fill(7);
const PASSWORD = 'correct-horse-battery-staple';

async function deriveVerifier(
  password: string,
  salt = new Uint8Array(16).fill(3),
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    key,
    256,
  );
  return `pbkdf2-sha256$600000$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

async function mintToken(secretFill = 9): Promise<{ plaintext: string; verifier: string }> {
  const secret = new Uint8Array(32).fill(secretFill);
  const plaintext = `nrd_pub_${Buffer.from(secret).toString('base64url')}`;
  const verifier = formatSha256Digest(await sha256Hex(new TextEncoder().encode(plaintext)));
  return { plaintext, verifier };
}

function asBody(bytes: Uint8Array): BodyInit {
  return Uint8Array.from(bytes);
}

async function buildGzip(
  siteId: SiteId,
  opts: { withAttachment?: boolean; pages?: Array<{ file: string; body: string }> } = {},
): Promise<{ gzip: Uint8Array; digest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-p11-'));
  try {
    const pages = opts.pages ?? [
      { file: 'index.md', body: '# Home\n\nHello world content here.\n' },
    ];
    for (const page of pages) {
      const full = path.join(root, page.file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, page.body);
    }
    if (opts.withAttachment) {
      await fs.mkdir(path.join(root, 'files'), { recursive: true });
      await fs.writeFile(path.join(root, 'files', 'note.pdf'), '%PDF-1.4 fixture');
      await fs.writeFile(
        path.join(root, 'index.md'),
        '# Home\n\nDownload [note](./files/note.pdf).\n',
      );
    }
    const config = parseNrdocsConfig({
      title: 'Handbook',
      language: 'en',
      direction: 'ltr',
      navigation: 'auto',
    });
    const { gzipBytes, digest } = await buildArtifactFromConfig(root, config, { siteId });
    return { gzip: gzipBytes, digest };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

type Harness = {
  env: WorkerEnv;
  store: MemoryArtifactStore;
  token: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
};

async function withReader(
  fn: (h: Harness) => Promise<void>,
  opts: {
    access?: 'public' | 'password';
    enabled?: boolean;
    publish?: boolean;
    withAttachment?: boolean;
    pages?: Array<{ file: string; body: string }>;
    rateLimiter?: MemoryRateLimiter;
  } = {},
): Promise<void> {
  const { executor } = openMemorySqlite();
  await applyMigrations(executor);
  await insertInstanceMetadata(executor, {
    id: INST,
    display_name: 'docs',
    account_id: 'acct',
    resource_suffix: '3f6m8p0q2r4s6t8v0w2x',
    canonical_origin: 'https://docs.example.com',
    deployed_version: '2.0.0',
  });
  const { plaintext, verifier } = await mintToken();
  const access = opts.access ?? 'public';
  await createSiteWithInitialToken(executor, {
    id: SITE,
    slug: 'handbook',
    access_mode: access,
    ...(access === 'password' ? { password_verifier: await deriveVerifier(PASSWORD) } : {}),
    initialToken: { id: TOK, name: 'initial', token_verifier: verifier },
  });
  if (opts.enabled === false) {
    await executor.run(`UPDATE sites SET enabled = 0 WHERE id = ?`, [SITE]);
  }

  const store = new MemoryArtifactStore();
  const env: WorkerEnv = {
    DB: sqliteAsD1Database(executor),
    ARTIFACTS: store,
    NRDOCS_INSTANCE_ID: INST,
    NRDOCS_PACKAGE_VERSION: '2.0.0',
    __artifactStore: store,
    __clientIp: '203.0.113.10',
    __sessionKey: SESSION_KEY,
    ...(opts.rateLimiter ? { __rateLimiter: opts.rateLimiter } : {}),
  };

  const fetch = (p: string, init: RequestInit = {}) =>
    handleRequest(new Request(`https://docs.example.com${p}`, init), env);

  if (opts.publish !== false) {
    const { gzip, digest } = await buildGzip(SITE, {
      ...(opts.withAttachment ? { withAttachment: true } : {}),
      ...(opts.pages ? { pages: opts.pages } : {}),
    });
    const published = await fetch('/_nrdocs/api/v1/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plaintext}`,
        'content-type': ARTIFACT_CONTENT_TYPE,
        'content-length': String(gzip.byteLength),
        [PUBLISHER_HEADERS.expectedSiteId]: SITE,
        [PUBLISHER_HEADERS.artifactDigest]: digest,
      },
      body: asBody(gzip),
    });
    if (published.status !== 200) {
      throw new Error(`publish failed: ${published.status} ${await published.text()}`);
    }
  }

  await fn({ env, store, token: plaintext, fetch });
}

function extractCsrf(html: string): string {
  const m = html.match(/name="csrf" value="([^"]+)"/);
  if (!m) throw new Error('csrf missing');
  return m[1]!;
}

function cookieFrom(res: Response, siteId: string = SITE): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const list = raw.length > 0 ? raw : [res.headers.get('set-cookie') ?? ''];
  const name = sessionCookieName(siteId);
  for (const c of list) {
    if (c.startsWith(`${name}=`)) {
      const value = c.slice(name.length + 1).split(';')[0]!;
      return `${name}=${value}`;
    }
  }
  return null;
}

describe('safe return path', () => {
  it('accepts only same-slug relative paths', () => {
    expect(validateSafeReturnPath('/handbook/guide/', 'handbook')).toBe('/handbook/guide/');
    expect(validateSafeReturnPath('/handbook', 'handbook')).toBe('/handbook/');
    expect(validateSafeReturnPath('/other/', 'handbook')).toBe('/handbook/');
    expect(validateSafeReturnPath('//evil', 'handbook')).toBe('/handbook/');
    expect(validateSafeReturnPath('/handbook/../x/', 'handbook')).toBe('/handbook/');
    expect(validateSafeReturnPath('/handbook/a?x=1', 'handbook')).toBe('/handbook/');
  });
});

describe('reader serving', () => {
  it('serves instance root HTML and platform assets', async () => {
    await withReader(
      async ({ fetch }) => {
        const root = await fetch('/');
        expect(root.status).toBe(200);
        expect(root.headers.get('content-type')).toMatch(/text\/html/);
        expect(root.headers.get('cache-control')).toBe('private, no-store');
        expect(root.headers.get('strict-transport-security')).toBe('max-age=31536000');
        const html = await root.text();
        expect(html).toContain('<h1>nrdocs</h1>');
        expect(html).toContain('This nrdocs instance serves sites at their direct URLs.');
        expect(html).not.toContain('handbook');

        const css = await fetch('/_nrdocs/v1/reader.css');
        expect(css.status).toBe(200);
        expect(css.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
        const etag = css.headers.get('etag');
        expect(etag).toBeTruthy();
        const notModified = await fetch('/_nrdocs/v1/reader.css', {
          headers: { 'if-none-match': etag! },
        });
        expect(notModified.status).toBe(304);
      },
      { publish: false },
    );
  });

  it('serves public site content without cookies', async () => {
    await withReader(async ({ fetch }) => {
      const bare = await fetch('/handbook');
      expect(bare.status).toBe(308);
      expect(bare.headers.get('location')).toBe('/handbook/');

      const res = await fetch('/handbook/');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      const body = await res.text();
      expect(body).toContain('Hello world');
      expect(body).not.toMatch(/artifact_/);

      const head = await fetch('/handbook/', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');

      const missing = await fetch('/handbook/nope/');
      expect(missing.status).toBe(404);
      expect(await missing.text()).toContain('Not found');

      const unknown = await fetch('/missing-site/');
      expect(unknown.status).toBe(404);
    });
  });

  it('returns identical 404 for empty, disabled, and unknown sites', async () => {
    await withReader(
      async ({ fetch }) => {
        const empty = await fetch('/handbook/');
        expect(empty.status).toBe(404);
        const emptyBody = await empty.text();

        const unknown = await fetch('/no-such-site/');
        expect(unknown.status).toBe(404);
        expect(await unknown.text()).toBe(emptyBody);
      },
      { publish: false },
    );

    await withReader(
      async ({ fetch }) => {
        const disabled = await fetch('/handbook/');
        expect(disabled.status).toBe(404);
        expect(await disabled.text()).toContain('Not found');
      },
      { enabled: false },
    );
  });

  it('serves attachments with disposition and rejects arbitrary keys', async () => {
    await withReader(
      async ({ fetch, store }) => {
        const res = await fetch('/handbook/files/note.pdf');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
        expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
        expect(res.headers.get('content-security-policy')).toContain('sandbox');

        const orphan = await fetch('/handbook/../../../etc/passwd');
        expect(orphan.status).toBe(404);

        // Direct R2-style path must not work as a reader route.
        const keys = [...store.objects.keys()];
        expect(keys.some((k) => k.includes('attachments/'))).toBe(true);
        const leak = await fetch(`/${keys[0]}`);
        expect(leak.status).toBe(404);
      },
      { withAttachment: true },
    );
  });

  it('returns 503 when current manifest object is missing', async () => {
    await withReader(async ({ fetch, store }) => {
      for (const key of [...store.objects.keys()]) {
        if (key.endsWith('nrdocs-manifest.json')) store.objects.delete(key);
      }
      const res = await fetch('/handbook/');
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('Site temporarily unavailable');
    });
  });

  it('password flow: redirect, deep-link return, session isolation, logout', async () => {
    await withReader(
      async ({ fetch, env }) => {
        const deep = await fetch('/handbook/');
        expect(deep.status).toBe(302);
        const loc = deep.headers.get('location')!;
        expect(loc).toContain('/_nrdocs/access?site=handbook');
        expect(loc).toContain('return=');

        const form = await fetch(loc);
        expect(form.status).toBe(200);
        const formHtml = await form.text();
        expect(formHtml).toContain('Password required');
        expect(formHtml).toContain('lang="en"');
        expect(formHtml).toContain('dir="ltr"');
        const csrf = extractCsrf(formHtml);

        const denied = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://evil.example',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        expect(denied.status).toBe(403);

        const wrong = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent('wrong-password-xx')}`,
        });
        expect(wrong.status).toBe(200);
        expect(await wrong.text()).toContain('The password is incorrect');

        const form2 = await fetch(loc);
        const csrf2 = extractCsrf(await form2.text());
        const ok = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf2)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        expect(ok.status).toBe(303);
        expect(ok.headers.get('location')).toBe('/handbook/');
        const sessionCookie = cookieFrom(ok);
        expect(sessionCookie).toContain(sessionCookieName(SITE));
        const setCookie = ok.headers.get('set-cookie') ?? '';
        expect(setCookie).toMatch(/Secure/);
        expect(setCookie).toMatch(/HttpOnly/);
        expect(setCookie).toMatch(/SameSite=Lax/);
        expect(setCookie).toMatch(/Max-Age=43200/);
        expect(setCookie).toMatch(/Path=\//);

        const authed = await fetch('/handbook/', {
          headers: { cookie: sessionCookie! },
        });
        expect(authed.status).toBe(200);
        expect(await authed.text()).toContain('Hello world');

        // Second site with same password must not accept this session.
        const sql = (await import('./index.js')).workerPersistence(env.DB);
        const { plaintext: tokenB, verifier: verB } = await mintToken(11);
        await createSiteWithInitialToken(sql, {
          id: SITE_B,
          slug: 'other',
          access_mode: 'password',
          password_verifier: await deriveVerifier(PASSWORD, new Uint8Array(16).fill(9)),
          initialToken: { id: TOK_B, name: 'b', token_verifier: verB },
        });
        const { gzip, digest } = await buildGzip(SITE_B);
        const pubB = await fetch('/_nrdocs/api/v1/publish', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tokenB}`,
            'content-type': ARTIFACT_CONTENT_TYPE,
            'content-length': String(gzip.byteLength),
            [PUBLISHER_HEADERS.expectedSiteId]: SITE_B,
            [PUBLISHER_HEADERS.artifactDigest]: digest,
          },
          body: asBody(gzip),
        });
        expect(pubB.status).toBe(200);

        const cross = await fetch('/other/', { headers: { cookie: sessionCookie! } });
        expect(cross.status).toBe(302);
        expect(cross.headers.get('location')).toContain('site=other');

        const logoutForm = await fetch('/_nrdocs/logout?site=handbook');
        expect(logoutForm.status).toBe(200);
        const logoutFormHtml = await logoutForm.text();
        expect(logoutFormHtml).toContain('<h1>Sign out</h1>');
        expect(logoutFormHtml).toContain('action="/_nrdocs/logout"');
        expect(logoutFormHtml).toContain('name="site" value="handbook"');
        const logoutFormCsrf = extractCsrf(logoutFormHtml);

        const loggedOut = await fetch('/_nrdocs/logout', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&csrf=${encodeURIComponent(logoutFormCsrf)}`,
        });
        expect(loggedOut.status).toBe(200);
        expect(await loggedOut.text()).toContain('You have been signed out.');
        expect(loggedOut.headers.get('set-cookie')).toMatch(/Max-Age=0/);
      },
      { access: 'password' },
    );
  }, 120_000);

  it('serves mermaid fences and platform mermaid.js', async () => {
    await withReader(
      async ({ fetch }) => {
        const page = await fetch('/handbook/');
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain('class="nr-mermaid"');
        expect(html).toContain('data-nr-mermaid');
        expect(html).toContain('flowchart LR');

        const mermaid = await fetch('/_nrdocs/v1/mermaid.js');
        expect(mermaid.status).toBe(200);
        expect(mermaid.headers.get('content-type')).toMatch(/javascript/);
        const body = await mermaid.text();
        expect(body).toContain('export default');
      },
      {
        pages: [
          {
            file: 'index.md',
            body: '# Diagrams\n\n```mermaid\nflowchart LR\n  A-->B\n```\n',
          },
        ],
      },
    );
  });

  it('password change invalidates existing sessions', async () => {
    await withReader(
      async ({ fetch, env }) => {
        const form = await fetch('/_nrdocs/access?site=handbook&return=%2Fhandbook%2F');
        const csrf = extractCsrf(await form.text());
        const ok = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        const sessionCookie = cookieFrom(ok)!;
        expect((await fetch('/handbook/', { headers: { cookie: sessionCookie } })).status).toBe(
          200,
        );

        const db = (await import('./index.js')).workerPersistence(env.DB);
        await changeSitePassword(db, SITE, await deriveVerifier('new-password-xyz1'));

        const again = await fetch('/handbook/', { headers: { cookie: sessionCookie } });
        expect(again.status).toBe(302);
      },
      { access: 'password' },
    );
  }, 120_000);

  it('rename drops old slug without redirect; public switch invalidates sessions', async () => {
    await withReader(
      async ({ fetch, env }) => {
        const form = await fetch('/_nrdocs/access?site=handbook&return=%2Fhandbook%2F');
        const csrf = extractCsrf(await form.text());
        const ok = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        const sessionCookie = cookieFrom(ok)!;

        const db = (await import('./index.js')).workerPersistence(env.DB);
        await renameSite(db, SITE, 'renamed');
        expect((await fetch('/handbook/')).status).toBe(404);
        const renamed = await fetch('/renamed/', { headers: { cookie: sessionCookie } });
        expect(renamed.status).toBe(200);

        await setSiteAccessPublic(db, SITE);
        expect((await fetch('/renamed/', { headers: { cookie: sessionCookie } })).status).toBe(200);
        // public site ignores cookie; switching back to password bumps generation
        await setSiteAccessPassword(db, SITE, await deriveVerifier(PASSWORD));
        expect((await fetch('/renamed/', { headers: { cookie: sessionCookie } })).status).toBe(302);
      },
      { access: 'password' },
    );
  }, 120_000);

  it('rate-limits password attempts before verification', async () => {
    const limiter = new MemoryRateLimiter();
    await withReader(
      async ({ fetch }) => {
        for (let i = 0; i < 10; i++) {
          const form = await fetch('/_nrdocs/access?site=handbook&return=%2Fhandbook%2F');
          const csrf = extractCsrf(await form.text());
          const res = await fetch('/_nrdocs/access', {
            method: 'POST',
            headers: {
              origin: 'https://docs.example.com',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent('wrong-password-xx')}`,
          });
          expect(res.status).toBe(200);
        }
        const form = await fetch('/_nrdocs/access?site=handbook&return=%2Fhandbook%2F');
        const csrf = extractCsrf(await form.text());
        const limited = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
      },
      { access: 'password', rateLimiter: limiter },
    );
  }, 180_000);
});

describe('reader disable and site helpers', () => {
  it('disable takes effect immediately', async () => {
    await withReader(async ({ fetch, env }) => {
      expect((await fetch('/handbook/')).status).toBe(200);
      const db = (await import('./index.js')).workerPersistence(env.DB);
      await setSiteEnabled(db, SITE, false);
      expect((await fetch('/handbook/')).status).toBe(404);
      const site = await getSiteById(db, SITE);
      expect(site?.enabled).toBe(false);
    });
  });
});
