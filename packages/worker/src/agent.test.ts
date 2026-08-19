import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import {
  ARTIFACT_CONTENT_TYPE,
  formatId,
  formatSha256Digest,
  parseNrdocsConfig,
  PUBLISHER_HEADERS,
  sealManifest,
  sha256Hex,
  type ArtifactId,
  type InstanceId,
  type SiteId,
  type TokenRecordId,
} from '@nrdocs/contracts';
import {
  applyMigrations,
  artifactObjectKey,
  changeSitePassword,
  createSiteWithInitialToken,
  insertInstanceMetadata,
  MemoryArtifactStore,
  renameSite,
  sqliteAsD1Database,
} from '@nrdocs/persistence';
import { openMemorySqlite } from '@nrdocs/persistence/sqlite';
import { assemblePageDocument, buildArtifactFromConfig } from '@nrdocs/renderer';
import { handleRequest, type WorkerEnv } from './index.js';
import { bytesToBase64Url } from './reader/crypto.js';
import { PLATFORM_JS_V2 } from './reader/platform-assets.js';
import { redactAgentGrantPath } from './redact.js';
import { sessionCookieName } from './reader/session.js';

const INST = formatId('inst', new Uint8Array(16).fill(1)) as InstanceId;
const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;
const TOK = formatId('tok', new Uint8Array(16).fill(3)) as TokenRecordId;
const SESSION_KEY = new Uint8Array(32).fill(7);
const PASSWORD = 'correct-horse-battery-staple';
const PASSWORD_ITERATIONS = 100_000;
const V1_ARTIFACT = formatId('artifact', new Uint8Array(16).fill(8)) as ArtifactId;

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
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

async function mintToken(): Promise<{ plaintext: string; verifier: string }> {
  const secret = new Uint8Array(32).fill(9);
  const plaintext = `nrd_pub_${Buffer.from(secret).toString('base64url')}`;
  const verifier = formatSha256Digest(await sha256Hex(new TextEncoder().encode(plaintext)));
  return { plaintext, verifier };
}

function asBody(bytes: Uint8Array): BodyInit {
  return Uint8Array.from(bytes);
}

async function buildGzip(
  siteId: SiteId,
  files: Record<string, string>,
): Promise<{ gzip: Uint8Array; digest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-agent-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
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

async function withAgent(
  fn: (h: {
    fetch: (path: string, init?: RequestInit) => Promise<Response>;
    env: WorkerEnv;
    store: MemoryArtifactStore;
    publish: (files?: Record<string, string>) => Promise<void>;
  }) => Promise<void>,
  opts: { access?: 'public' | 'password' } = {},
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
  const store = new MemoryArtifactStore();
  const env: WorkerEnv = {
    DB: sqliteAsD1Database(executor),
    ARTIFACTS: store,
    NRDOCS_INSTANCE_ID: INST,
    NRDOCS_PACKAGE_VERSION: '2.0.0',
    NRDOCS_CANONICAL_ORIGIN: 'https://docs.example.com',
    __artifactStore: store,
    __clientIp: '203.0.113.10',
    __sessionKey: SESSION_KEY,
  };
  const fetch = (p: string, init: RequestInit = {}) =>
    handleRequest(new Request(`https://docs.example.com${p}`, init), env);
  const publish = async (files?: Record<string, string>) => {
    const { gzip, digest } = await buildGzip(
      SITE,
      files ?? {
        'index.md': '# Home\n\nHello world content here.\n\n![x](images/a.png)\n',
        'images/a.png': 'PNGDATA',
        'files/note.pdf': '%PDF-1.4 fixture',
      },
    );
    if (!files) {
      const extra = await buildGzip(SITE, {
        'index.md':
          '# Home\n\nHello world content here.\n\n![x](images/a.png)\n\n[pdf](files/note.pdf)\n',
        'images/a.png': 'PNGDATA',
        'files/note.pdf': '%PDF-1.4 fixture',
      });
      const published = await fetch('/_nrdocs/api/v1/publish', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${plaintext}`,
          'content-type': ARTIFACT_CONTENT_TYPE,
          'content-length': String(extra.gzip.byteLength),
          [PUBLISHER_HEADERS.expectedSiteId]: SITE,
          [PUBLISHER_HEADERS.artifactDigest]: extra.digest,
        },
        body: asBody(extra.gzip),
      });
      if (published.status !== 200) {
        throw new Error(`publish failed: ${published.status} ${await published.text()}`);
      }
      return;
    }
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
  };
  await fn({ fetch, env, store, publish });
}

function extractCookie(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  const list = raw.length > 0 ? raw : [res.headers.get('set-cookie') ?? ''];
  const name = sessionCookieName(SITE);
  for (const c of list) {
    if (c.startsWith(`${name}=`)) return `${name}=${c.slice(name.length + 1).split(';')[0]!}`;
  }
  throw new Error('session cookie missing');
}

describe('agent access', () => {
  it('redacts grant path segments', () => {
    expect(redactAgentGrantPath('/_nrdocs/agent/share/v1.abc.def/index.md')).toBe(
      '/_nrdocs/agent/share/[REDACTED_GRANT]/index.md',
    );
  });

  it('serves public v2 agent routes and Link alternate', async () => {
    await withAgent(async ({ fetch, publish }) => {
      await publish();
      const html = await fetch('/handbook/');
      expect(html.status).toBe(200);
      expect(html.headers.get('content-security-policy')).toContain("connect-src 'self'");
      expect(html.headers.get('link')).toContain('/_nrdocs/agent/handbook/index.md');
      const page = await html.text();
      expect(page).toContain('nr-ai-share');
      expect(page).not.toContain('site_');

      const index = await fetch('/_nrdocs/agent/handbook/index.md');
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toMatch(/text\/markdown/);
      expect(index.headers.get('cache-control')).toBe('private, no-store');
      const md = await index.text();
      expect(md).toContain('Handbook');
      expect(md).toContain('manifest.json');

      const all = await fetch('/_nrdocs/agent/handbook/all.md');
      expect(all.status).toBe(200);
      const manifest = await fetch('/_nrdocs/agent/handbook/manifest.json');
      expect(manifest.status).toBe(200);
      const parsed = JSON.parse(await manifest.text()) as {
        publication: { content_digest: string };
      };
      expect(parsed.publication.content_digest.startsWith('sha256:')).toBe(true);

      const share = await fetch('/_nrdocs/agent-share?site=handbook');
      expect(share.status).toBe(200);
      const body = (await share.json()) as { entry_url: string; expires_at: null };
      expect(body.expires_at).toBeNull();
      expect(body.entry_url).toBe('https://docs.example.com/_nrdocs/agent/handbook/index.md');

      const head = await fetch('/_nrdocs/agent/handbook/index.md', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect((await fetch('/_nrdocs/agent/handbook/index.md', { method: 'POST' })).status).toBe(
        405,
      );

      const folded = await fetch('/_nrdocs/agent/Handbook/index.md', { redirect: 'manual' });
      expect(folded.status).toBe(308);
      expect(folded.headers.get('location')).toBe('/_nrdocs/agent/handbook/index.md');

      expect((await fetch('/_nrdocs/agent-share', { method: 'POST' })).status).toBe(404);
      expect((await fetch('/_nrdocs/agent/share/v1.not-a-grant/index.md')).status).toBe(404);
    });
  });

  it('creates a protected grant and follows republish, rename, and password change', async () => {
    await withAgent(
      async ({ fetch, publish, env }) => {
        await publish();
        const form = await fetch('/_nrdocs/access?site=handbook&return=%2Fhandbook%2F');
        const csrf = (await form.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
        const login = await fetch('/_nrdocs/access', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: `site=handbook&return=${encodeURIComponent('/handbook/')}&csrf=${encodeURIComponent(csrf)}&password=${encodeURIComponent(PASSWORD)}`,
        });
        const cookie = extractCookie(login);

        const denied = await fetch('/_nrdocs/agent/handbook/index.md');
        expect(denied.status).toBe(404);

        const authed = await fetch('/_nrdocs/agent/handbook/index.md', { headers: { cookie } });
        expect(authed.status).toBe(200);

        const prep = await fetch('/_nrdocs/agent-share?site=handbook', { headers: { cookie } });
        const prepJson = (await prep.json()) as { csrf: string };
        const created = await fetch('/_nrdocs/agent-share', {
          method: 'POST',
          headers: {
            origin: 'https://docs.example.com',
            cookie,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ site: 'handbook', duration: '24h', csrf: prepJson.csrf }),
        });
        expect(created.status).toBe(200);
        const grantJson = (await created.json()) as { entry_url: string };
        const grantPath = new URL(grantJson.entry_url).pathname.replace(/index\.md$/, '');

        const viaGrant = await fetch(`${grantPath}index.md`);
        expect(viaGrant.status).toBe(200);
        const first = await viaGrant.text();

        await publish({ 'index.md': '# Home\n\nUpdated publication body.\n' });
        const afterIndex = await fetch(`${grantPath}index.md`);
        expect(afterIndex.status).toBe(200);
        expect(await afterIndex.text()).toBe(first);
        const afterMan = (await (await fetch(`${grantPath}manifest.json`)).json()) as {
          pages: Array<{ markdown_path: string }>;
        };
        const pageMd = await fetch(`${grantPath}${afterMan.pages[0]!.markdown_path}`);
        expect(pageMd.status).toBe(200);
        expect(await pageMd.text()).toContain('Updated publication body');

        const db = (await import('./index.js')).workerPersistence(env.DB);
        await renameSite(db, SITE, 'renamed');
        expect((await fetch('/_nrdocs/agent/handbook/index.md')).status).toBe(404);
        expect((await fetch(`${grantPath}index.md`)).status).toBe(200);

        await changeSitePassword(db, SITE, await deriveVerifier('new-password-xyz1'));
        expect((await fetch(`${grantPath}index.md`)).status).toBe(404);
      },
      { access: 'password' },
    );
  }, 180_000);

  it('serves images and attachments on agent routes', async () => {
    await withAgent(async ({ fetch, publish }) => {
      await publish();
      const man = (await (await fetch('/_nrdocs/agent/handbook/manifest.json')).json()) as {
        assets: Array<{ path: string }>;
        attachments: Array<{ path: string }>;
      };
      const img = await fetch(`/_nrdocs/agent/handbook/${man.assets[0]!.path}`);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toMatch(/image\//);
      const att = await fetch(`/_nrdocs/agent/handbook/${man.attachments[0]!.path}`);
      expect(att.status).toBe(200);
      expect(att.headers.get('content-disposition')).toMatch(/^attachment;/);
    });
  });

  it('keeps v1 human pages without agent routes', async () => {
    await withAgent(async ({ fetch, env, store }) => {
      const html = assemblePageDocument({
        language: 'en',
        direction: 'ltr',
        siteTitle: 'Handbook',
        pageTitle: 'Home',
        pageRoute: '/',
        articleHtml: '<h1 id="nr-h-0123456789abcdef">Home</h1>\n<p>Legacy</p>\n',
        navTree: [],
        prev: null,
        next: null,
      });
      const bytes = new TextEncoder().encode(html);
      const sha = await sha256Hex(bytes);
      const draft = {
        schema_version: 1 as const,
        site_id: SITE,
        generator: { name: 'nrdocs' as const, version: '2.0.0' },
        site: {
          title: 'Handbook',
          language: 'en',
          direction: 'ltr' as const,
          root: { kind: 'page' as const, route: '/' as const },
        },
        pages: [
          {
            route: '/',
            object: 'pages/index.html',
            title: 'Home',
            size: bytes.byteLength,
            sha256: sha,
          },
        ],
        assets: [],
        attachments: [],
        artifact: { file_count: 1, uncompressed_size: bytes.byteLength },
      };
      const manifest = await sealManifest(draft);
      await store.put({
        key: artifactObjectKey(SITE, V1_ARTIFACT, 'nrdocs-manifest.json'),
        body: new TextEncoder().encode(JSON.stringify(manifest)),
      });
      await store.put({
        key: artifactObjectKey(SITE, V1_ARTIFACT, 'pages/index.html'),
        body: bytes,
      });
      const db = (await import('./index.js')).workerPersistence(env.DB);
      await db.run(
        `UPDATE sites SET current_artifact_id = ?, current_artifact_digest = ?, current_root_route = ?, current_language = ?, current_direction = ?, current_page_count = 1, current_asset_count = 0, current_attachment_count = 0, last_published_at = ?, updated_at = ? WHERE id = ?`,
        [
          V1_ARTIFACT,
          manifest.artifact.digest,
          '/',
          'en',
          'ltr',
          '2026-01-15T12:00:00Z',
          '2026-01-15T12:00:00Z',
          SITE,
        ],
      );
      const page = await fetch('/handbook/');
      expect(page.status).toBe(200);
      const body = await page.text();
      expect(body).toContain('Legacy');
      expect(body).not.toContain('nr-ai-share');
      expect(page.headers.get('link')).toBeNull();
      expect((await fetch('/_nrdocs/agent/handbook/index.md')).status).toBe(404);
    });
  });

  it('v2 reader script includes the share dialog', () => {
    expect(PLATFORM_JS_V2).toContain('Copy a prompt for an AI');
    expect(PLATFORM_JS_V2).toContain('navigator.clipboard');
    expect(PLATFORM_JS_V2).toContain('Clipboard copy failed');
    const { document } = parseHTML(
      '<button class="nr-ai-share nr-icon-btn" type="button" aria-label="Copy a prompt for an AI">Copy a prompt for an AI</button>',
    );
    expect(document.querySelector('.nr-ai-share')?.textContent).toBe('Copy a prompt for an AI');
  });
});
