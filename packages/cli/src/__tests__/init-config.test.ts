import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  validateDocsConfig,
  validateDocsConfigFile,
  resolveDocsApiUrl,
  salvageDocsFields,
  buildDocsConfig,
  parseDocsConfigFile,
} from '../config/docs-config.js';
import {
  planInit,
  describeApiUrlSource,
  normalizeInitUrl,
} from '../commands/init.js';
import { saveConfig, createDefaultConfig, setProfile, createProfile } from '../config/index.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nrdocs-init-test-'));
}

const VALID_CONFIG = `site:
  title: Test Docs
  api_url: https://docs.example.com
export: true
content:
  source_dir: .
  nav: auto
`;

const INVALID_HUGO_STYLE = `title: Mar-x-Auder Guide
description: A theory-first guide
nav:
  - Preface: 00-preface.md
`;

describe('validateDocsConfig', () => {
  it('accepts a valid config', () => {
    const config = buildDocsConfig({
      title: 'Test Docs',
      apiUrl: 'https://docs.example.com',
    });
    expect(validateDocsConfig(config)).toEqual({
      valid: true,
      title: 'Test Docs',
      apiUrl: 'https://docs.example.com',
    });
  });

  it('rejects missing site section', () => {
    const result = validateDocsConfig({ content: { source_dir: '.' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing "site:" section');
  });

  it('rejects missing content section', () => {
    const result = validateDocsConfig({
      site: { title: 'T', api_url: 'https://docs.example.com' },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing "content:" section');
  });

  it('rejects missing site.api_url', () => {
    const result = validateDocsConfig({
      site: { title: 'T' },
      content: { source_dir: '.' },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('site.api_url is required');
  });
});

describe('validateDocsConfigFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates valid file on disk', () => {
    const configPath = path.join(tmpDir, 'nrdocs.yml');
    fs.writeFileSync(configPath, VALID_CONFIG);
    expect(validateDocsConfigFile(configPath).valid).toBe(true);
  });

  it('rejects hugo-style config', () => {
    const configPath = path.join(tmpDir, 'nrdocs.yml');
    fs.writeFileSync(configPath, INVALID_HUGO_STYLE);
    const result = validateDocsConfigFile(configPath);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing "site:" section');
  });
});

describe('salvageDocsFields', () => {
  it('salvages top-level title from broken config', () => {
    const parsed = parseDocsConfigFile(path.join(makeTmpDir(), 'missing.yml'));
    expect(parsed).toBeNull();

    const salvaged = salvageDocsFields({
      title: 'Mar-x-Auder Guide',
      description: 'A guide',
      export: false,
    } as never);
    expect(salvaged.title).toBe('Mar-x-Auder Guide');
    expect(salvaged.description).toBe('A guide');
    expect(salvaged.exportEnabled).toBe(false);
  });
});

describe('resolveDocsApiUrl', () => {
  let tmpDir: string;
  let configDir: string;
  let configPath: string;
  let workflowPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'nrdocs.yml');
    workflowPath = path.join(tmpDir, '.github', 'workflows', 'nrdocs.yml');
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prefers flag over env and profile', () => {
    expect(
      resolveDocsApiUrl({
        flag: 'https://flag.example.com',
        env: 'https://env.example.com',
        profileUrl: 'https://profile.example.com',
      }),
    ).toBe('https://flag.example.com');
  });

  it('reads api_url from workflow when config is invalid', () => {
    fs.writeFileSync(configPath, INVALID_HUGO_STYLE);
    fs.writeFileSync(
      workflowPath,
      'env:\n  NRDOCS_API_URL: https://workflow.example.com\n',
    );
    expect(
      resolveDocsApiUrl({
        configPath,
        workflowPath,
      }),
    ).toBe('https://workflow.example.com');
  });

  it('falls back to operator profile', () => {
    fs.writeFileSync(configPath, INVALID_HUGO_STYLE);
    expect(
      resolveDocsApiUrl({
        configPath,
        workflowPath,
        profileUrl: 'https://profile.example.com',
      }),
    ).toBe('https://profile.example.com');
  });
});

describe('planInit', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configPath = path.join(tmpDir, 'nrdocs.yml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not rewrite a valid config without --force', () => {
    fs.writeFileSync(configPath, VALID_CONFIG);
    const plan = planInit(configPath, {}, {
      defaultTitle: 'Repo Docs',
      apiUrl: 'https://docs.example.com',
      apiUrlSource: 'operator profile',
    });
    expect(plan.writeConfig).toBe(false);
    expect(plan.repaired).toBe(false);
  });

  it('plans repair for invalid config', () => {
    fs.writeFileSync(configPath, INVALID_HUGO_STYLE);
    const plan = planInit(configPath, {}, {
      defaultTitle: 'Repo Docs',
      apiUrl: 'https://docs.example.com',
      apiUrlSource: 'operator profile',
    });
    expect(plan.writeConfig).toBe(true);
    expect(plan.repaired).toBe(true);
    expect(plan.title).toBe('Mar-x-Auder Guide');
    expect(plan.repairNotes.some((n) => n.includes('repaired invalid'))).toBe(true);
  });

  it('creates config when missing', () => {
    const plan = planInit(configPath, {}, {
      defaultTitle: 'Repo Docs',
      apiUrl: 'https://docs.example.com',
      apiUrlSource: 'operator profile',
    });
    expect(plan.writeConfig).toBe(true);
    expect(plan.repaired).toBe(false);
    expect(plan.title).toBe('Repo Docs');
  });
});

describe('normalizeInitUrl', () => {
  it('adds https and strips trailing slash', () => {
    expect(normalizeInitUrl('docs.example.com/')).toBe('https://docs.example.com');
  });
});

describe('describeApiUrlSource', () => {
  let tmpDir: string;
  let configPath: string;
  let workflowPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configPath = path.join(tmpDir, 'nrdocs.yml');
    workflowPath = path.join(tmpDir, 'workflow.yml');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports --api-url when flag is set', () => {
    expect(describeApiUrlSource({ apiUrl: 'https://x.com' }, configPath, workflowPath)).toBe(
      '--api-url',
    );
  });
});

describe('init integration with profile', () => {
  let tmpDir: string;
  let configDir: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, 'config');
    originalXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = configDir;

    const cfg = createDefaultConfig();
    saveConfig(cfg, configDir);
    setProfile('default', createProfile('https://profile.example.com', 'nrdocs_op_test'), configDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalXdg === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    }
  });

  it('resolveDocsApiUrl uses profile for invalid config', () => {
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const configPath = path.join(docsDir, 'nrdocs.yml');
    fs.writeFileSync(configPath, INVALID_HUGO_STYLE);

    expect(
      resolveDocsApiUrl({
        configPath,
        profileUrl: 'https://profile.example.com',
      }),
    ).toBe('https://profile.example.com');
  });
});
