import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseNrdocsConfig, type SiteId } from '@nrdocs/contracts';
import { buildArtifactFromConfig } from '@nrdocs/renderer';
import { ExitCode, createProcessRuntime, type Runtime } from './index.js';
import type { CommandContext } from './command-context.js';
import { createRejectingTerminal } from './terminal.js';
import { runPreviewCommand } from './preview.js';
import {
  attachmentContentDisposition,
  listenPreviewServer,
  normalizeRequestPath,
  PREVIEW_PORT_START,
} from './preview-server.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      writeStdout: (t: string) => {
        stdout += t;
      },
      writeStderr: (t: string) => {
        stderr += t;
      },
    },
  };
}

async function withTemp(
  fn: (runtime: Runtime, cap: ReturnType<typeof captureIo>, docs: string) => Promise<void>,
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cli-'));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-cwd-'));
  const docs = path.join(cwd, 'docs');
  await fs.mkdir(docs);
  const cap = captureIo();
  const runtime = createProcessRuntime({
    homeDir: home,
    cwd,
    platform: 'linux',
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false,
    env: { HOME: home },
    io: cap.io,
  });
  try {
    await fn(runtime, cap, docs);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

function ctxFor(runtime: Runtime): CommandContext {
  return {
    runtime,
    terminal: createRejectingTerminal(),
    json: false,
    help: false,
  };
}

describe('preview path helpers', () => {
  it('normalizes paths and rejects traversal', () => {
    expect(normalizeRequestPath('/')).toBe('/');
    expect(normalizeRequestPath('/overview/')).toBe('/overview/');
    expect(normalizeRequestPath('/overview')).toBe('/overview');
    expect(normalizeRequestPath('/a/b/c.png')).toBe('/a/b/c.png');
    expect(normalizeRequestPath('/a/../b')).toBe(null);
    expect(normalizeRequestPath('/a/%2e%2e/b')).toBe(null);
  });

  it('builds attachment Content-Disposition per contract', () => {
    expect(attachmentContentDisposition('checklist.pdf')).toBe(
      `attachment; filename="download"; filename*=UTF-8''checklist.pdf`,
    );
    expect(attachmentContentDisposition('a/b.pdf')).toBe(
      `attachment; filename="download"; filename*=UTF-8''ab.pdf`,
    );
    expect(attachmentContentDisposition('')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    );
  });
});

describe('nrdocs preview', () => {
  it('works without publish.credential and serves routes on 127.0.0.1', async () => {
    await withTemp(async (runtime, cap, docs) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'title: Handbook\nlanguage: en\ndirection: ltr\nnavigation: auto\n',
      );
      await fs.writeFile(
        path.join(docs, 'index.md'),
        '# Home\n\nSee [Overview](01-overview.md).\n\n![a](images/a.png)\n\n[PDF](files/notes.pdf)\n',
      );
      await fs.writeFile(path.join(docs, '01-overview.md'), '# Overview\n\nBody.\n');
      await fs.mkdir(path.join(docs, 'images'));
      await fs.writeFile(path.join(docs, 'images', 'a.png'), 'PNGDATA');
      await fs.mkdir(path.join(docs, 'files'));
      await fs.writeFile(path.join(docs, 'files', 'notes.pdf'), '%PDF-1.4');

      const before = await fs.readdir(docs, { recursive: true });
      const ac = new AbortController();

      await runPreviewCommand(ctxFor(runtime), ['docs'], {
        signal: ac.signal,
        onListening: async (server) => {
          expect(server.host).toBe('127.0.0.1');
          expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
          expect(server.port).toBeGreaterThanOrEqual(PREVIEW_PORT_START);

          const home = await fetch(server.url);
          expect(home.status).toBe(200);
          expect(home.headers.get('content-type')).toMatch(/text\/html/);
          const html = await home.text();
          expect(html).toContain('lang="en"');
          expect(html).toContain('dir="ltr"');
          expect(html).toContain('Handbook');

          const nested = await fetch(new URL('/overview/', server.url));
          expect(nested.status).toBe(200);
          expect(await nested.text()).toContain('Overview');

          const asset = await fetch(new URL('/images/a.png', server.url));
          expect(asset.status).toBe(200);
          expect(asset.headers.get('content-type')).toBe('image/png');
          expect(await asset.text()).toBe('PNGDATA');

          const att = await fetch(new URL('/files/notes.pdf', server.url));
          expect(att.status).toBe(200);
          expect(att.headers.get('content-type')).toBe('application/pdf');
          expect(att.headers.get('content-disposition')).toMatch(/filename="download"/);
          expect(att.headers.get('content-disposition')).toMatch(/filename\*=UTF-8''notes\.pdf/);

          const missing = await fetch(new URL('/nope/', server.url));
          expect(missing.status).toBe(404);

          const css = await fetch(new URL('/_nrdocs/v1/reader.css', server.url));
          expect(css.status).toBe(200);

          ac.abort();
        },
      });

      expect(cap.stdout).toContain('Preview ready.');
      expect(cap.stdout).toMatch(/URL: http:\/\/127\.0\.0\.1:\d+\//);
      expect(cap.stdout).toMatch(/Pages:\s+2/);
      expect(cap.stdout).toMatch(/Images:\s+1/);
      expect(cap.stdout).toMatch(/Attachments:\s+1/);

      const after = await fs.readdir(docs, { recursive: true });
      expect(after.sort()).toEqual(before.sort());
    });
  });

  it('preserves und/auto lang and dir defaults', async () => {
    await withTemp(async (runtime, _cap, docs) => {
      await fs.writeFile(path.join(docs, 'nrdocs.yml'), 'title: Site\nnavigation: auto\n');
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      const ac = new AbortController();
      await runPreviewCommand(ctxFor(runtime), ['docs'], {
        signal: ac.signal,
        onListening: async (server) => {
          const html = await (await fetch(server.url)).text();
          expect(html).toContain('lang="und"');
          expect(html).toContain('dir="auto"');
          ac.abort();
        },
      });
    });
  });

  it('fails validation before binding a port', async () => {
    await withTemp(async (runtime, cap, docs) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'title: Site\nnavigation:\n  - title: Missing\n    file: gone.md\n',
      );
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');

      await expect(runPreviewCommand(ctxFor(runtime), ['docs'])).rejects.toMatchObject({
        exit_code: ExitCode.LocalValidation,
      });
      expect(cap.stdout).not.toContain('Preview ready.');
    });
  });

  it('redirects when root is not a page', async () => {
    await withTemp(async (runtime, _cap, docs) => {
      await fs.writeFile(
        path.join(docs, 'nrdocs.yml'),
        'title: Site\nnavigation:\n  - title: Intro\n    file: 01-intro.md\n',
      );
      await fs.writeFile(path.join(docs, '01-intro.md'), '# Intro\n');
      const ac = new AbortController();
      await runPreviewCommand(ctxFor(runtime), ['docs'], {
        signal: ac.signal,
        onListening: async (server) => {
          const res = await fetch(server.url, { redirect: 'manual' });
          expect(res.status).toBe(308);
          expect(res.headers.get('location')).toBe('/intro/');
          ac.abort();
        },
      });
    });
  });

  it('rejects non-loopback bind attempts', async () => {
    await withTemp(async (_runtime, _cap, docs) => {
      await fs.writeFile(path.join(docs, 'nrdocs.yml'), 'title: Site\nnavigation: auto\n');
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');
      const config = parseNrdocsConfig({ title: 'Site', navigation: 'auto' });
      const { artifact } = await buildArtifactFromConfig(docs, config, {
        siteId: 'site_01ARZ3NDEKTSV4RRFFQ69G5FAV' as SiteId,
      });
      await expect(listenPreviewServer(artifact, { host: '0.0.0.0' })).rejects.toMatchObject({
        exit_code: ExitCode.LocalIoOrState,
      });
    });
  });

  it('advances past an occupied starting port', async () => {
    await withTemp(async (runtime, _cap, docs) => {
      await fs.writeFile(path.join(docs, 'nrdocs.yml'), 'title: Site\nnavigation: auto\n');
      await fs.writeFile(path.join(docs, 'index.md'), '# Home\n');

      const blocker = http.createServer((_req, res) => res.end('busy'));
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject);
        blocker.listen(PREVIEW_PORT_START, '127.0.0.1', () => resolve());
      });

      try {
        const ac = new AbortController();
        await runPreviewCommand(ctxFor(runtime), ['docs'], {
          signal: ac.signal,
          onListening: async (server) => {
            expect(server.port).toBeGreaterThan(PREVIEW_PORT_START);
            expect(server.host).toBe('127.0.0.1');
            ac.abort();
          },
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          blocker.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });
});
