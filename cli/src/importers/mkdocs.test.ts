import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { convertMkDocsNav, mkdocsImporter } from './mkdocs';

const TMP = join('cli', 'src', '__test_mkdocs_import_tmp__');

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: TMP,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'nrdocs test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'nrdocs test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  const full = join(TMP, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function initRepo(): void {
  git(['init']);
  git(['checkout', '-b', 'main']);
}

function commitAll(message = 'commit'): void {
  git(['add', '.']);
  git(['commit', '-m', message]);
}

describe('convertMkDocsNav', () => {
  it('converts leaf and nested section entries', () => {
    const result = convertMkDocsNav([
      { Home: 'index.md' },
      {
        Guide: [
          { Intro: 'guide/intro.md' },
          { Deep: [{ Install: 'guide/install.md' }] },
        ],
      },
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.nav).toEqual([
      { label: 'Home', path: 'index' },
      {
        label: 'Guide',
        section: true,
        children: [
          { label: 'Intro', path: 'guide/intro' },
          {
            label: 'Deep',
            section: true,
            children: [{ label: 'Install', path: 'guide/install' }],
          },
        ],
      },
    ]);
  });

  it('skips external links with a warning', () => {
    const result = convertMkDocsNav([{ External: 'https://example.com' }]);
    expect(result.nav).toEqual([]);
    expect(result.warnings[0]).toContain('external URL');
  });
});

describe('mkdocsImporter', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    initRepo();
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('generates nrdocs files from mkdocs.yml', async () => {
    write('mkdocs.yml', [
      'site_name: MkDocs Site',
      'site_description: Imported docs',
      'docs_dir: mkdocs_docs',
      'nav:',
      '  - Home: index.md',
      '  - Guide:',
      '      - Intro: guide/intro.md',
      'plugins:',
      '  - search',
      '',
    ].join('\n'));
    write('mkdocs_docs/index.md', '# Home\n');
    write('mkdocs_docs/guide/intro.md', '# Intro\n');
    commitAll('mkdocs source');

    const result = await mkdocsImporter.run({ cwd: TMP }, ['--accept-unsupported-customizations']);

    expect(existsSync(join(TMP, 'docs', 'project.yml'))).toBe(true);
    expect(existsSync(join(TMP, 'docs', 'nav.yml'))).toBe(true);
    expect(existsSync(join(TMP, 'docs', 'content', 'index.md'))).toBe(true);
    expect(existsSync(join(TMP, '.github', 'workflows', 'publish-docs.yml'))).toBe(false);

    const project = parse(readFileSync(join(TMP, 'docs', 'project.yml'), 'utf8')) as Record<string, unknown>;
    expect(project.slug).toBe('mkdocs-site');
    expect(project.title).toBe('MkDocs Site');
    expect(project.publish_enabled).toBe(true);
    expect(project.access_mode).toBe('public');

    const nav = parse(readFileSync(join(TMP, 'docs', 'nav.yml'), 'utf8')) as Record<string, unknown>;
    expect(nav.nav).toEqual([
      { label: 'Home', path: 'index' },
      {
        label: 'Guide',
        section: true,
        children: [{ label: 'Intro', path: 'guide/intro' }],
      },
    ]);

    expect(git(['branch', '--show-current'])).toBe('nrdocs');
    expect(result.warnings.some((w) => w.includes('plugins'))).toBe(true);
    expect(result.nextSteps.join('\n')).not.toContain('NRDOCS_API_URL');
  });

  it('parses mkdocs.yml with !ENV tags without warnings', async () => {
    write('mkdocs.yml', [
      'site_name: Env Tag Site',
      'docs_dir: docs',
      'extra:',
      '  global_password: !ENV [SITE_PASSWORD, ""]',
      'nav:',
      '  - Home: index.md',
      '',
    ].join('\n'));
    write('docs/index.md', '# Home\n');
    commitAll('mkdocs source');

    const warn = vi.spyOn(process, 'emitWarning');
    await mkdocsImporter.run({ cwd: TMP }, ['--accept-unsupported-customizations']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses docs by default on the nrdocs branch when MkDocs docs_dir is docs', async () => {
    write('mkdocs.yml', 'site_name: My Site\n');
    write('docs/index.md', '# Home\n');
    commitAll('mkdocs source');

    await mkdocsImporter.run({ cwd: TMP }, []);

    expect(existsSync(join(TMP, 'docs', 'content', 'index.md'))).toBe(true);
    expect(existsSync(join(TMP, 'docs', 'index.md'))).toBe(false);
    expect(existsSync(join(TMP, 'docs-nrdocs'))).toBe(false);
  });

  it('refuses to regenerate an existing import branch unless forced', async () => {
    write('mkdocs.yml', 'site_name: My Site\n');
    write('docs/index.md', '# Home\n');
    commitAll('mkdocs source');
    git(['switch', '-c', 'nrdocs']);
    write('docs/project.yml', 'slug: old\n');
    commitAll('old import');
    git(['switch', 'main']);

    await expect(mkdocsImporter.run({ cwd: TMP }, [])).rejects.toThrow(/--force/);

    await mkdocsImporter.run({ cwd: TMP }, ['--force']);
    const project = parse(readFileSync(join(TMP, 'docs', 'project.yml'), 'utf8')) as Record<string, unknown>;
    expect(project.slug).toBe('my-site');
  });

  it('requires explicit approval when unsupported MkDocs customizations are present', async () => {
    write('mkdocs.yml', [
      'site_name: Custom Site',
      'theme:',
      '  name: material',
      '  custom_dir: overrides',
      'plugins:',
      '  - search',
      '',
    ].join('\n'));
    write('docs/index.md', '# Home\n');
    commitAll('mkdocs source');

    await expect(mkdocsImporter.run({ cwd: TMP }, [])).rejects.toThrow(/accept-unsupported-customizations/);
    expect(git(['branch', '--show-current'])).toBe('main');

    await mkdocsImporter.run({ cwd: TMP }, ['--accept-unsupported-customizations']);
    expect(git(['branch', '--show-current'])).toBe('nrdocs');
  });
});
