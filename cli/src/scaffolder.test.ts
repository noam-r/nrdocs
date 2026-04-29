import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  generateProjectYml,
  generateNavYml,
  generateHomeMd,
  generatePublishWorkflow,
  checkExistingFile,
  validateExistingProjectYml,
  validateExistingNavYml,
  validateExistingWorkflow,
  type ScaffoldConfig,
} from './scaffolder.js';

const TEST_DIR = join('cli', 'src', '__test_scaffolder_tmp__');

function makeConfig(overrides: Partial<ScaffoldConfig> = {}): ScaffoldConfig {
  return {
    slug: 'my-project',
    title: 'My Project',
    description: 'A test project',
    docsDir: 'docs',
    apiUrl: 'https://nrdocs-cp.example.com',
    repoIdentity: 'github.com/owner/repo',
    publishBranch: 'main',
    ...overrides,
  };
}

describe('generateProjectYml', () => {
  it('generates YAML with slug, title, and description', () => {
    const config = makeConfig();
    const yml = generateProjectYml(config);
    const parsed = parse(yml) as Record<string, unknown>;
    expect(parsed.slug).toBe('my-project');
    expect(parsed.title).toBe('My Project');
    expect(parsed.description).toBe('A test project');
  });

  it('includes publish_enabled and access_mode', () => {
    const yml = generateProjectYml(makeConfig());
    const parsed = parse(yml) as Record<string, unknown>;
    expect(parsed.publish_enabled).toBe(true);
    expect(parsed.access_mode).toBe('public');
  });

  it('handles empty description', () => {
    const yml = generateProjectYml(makeConfig({ description: '' }));
    const parsed = parse(yml) as Record<string, unknown>;
    expect(parsed.description).toBe('');
  });
});

describe('generateNavYml', () => {
  it('generates nav with Home entry pointing to home', () => {
    const yml = generateNavYml();
    const parsed = parse(yml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('nav');
    const nav = (parsed as { nav: Array<{ label: string; path: string }> }).nav;
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe('Home');
    expect(nav[0].path).toBe('home');
  });
});

describe('generateHomeMd', () => {
  it('generates markdown with frontmatter and project title heading', () => {
    const md = generateHomeMd('My Project');
    expect(md).toContain('title: Home');
    expect(md).toContain('order: 1');
    expect(md).toContain('# My Project');
    expect(md).toContain('Welcome to My Project documentation.');
  });

  it('includes frontmatter delimiters', () => {
    const md = generateHomeMd('Test');
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('\n---\n');
  });
});

describe('generatePublishWorkflow', () => {
  const config = makeConfig();

  it('exchanges GitHub OIDC token for publish credentials', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('/oidc/publish-credentials');
    expect(wf).toContain('ACTIONS_ID_TOKEN_REQUEST_URL');
  });

  it('contains X-Repo-Identity header', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('X-Repo-Identity');
    expect(wf).toContain('github.com/${{ github.repository }}');
  });

  it('embeds the API URL directly', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('https://nrdocs-cp.example.com');
  });

  it('requests id-token permission', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('id-token: write');
  });

  it('triggers on push to main', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('push:');
    expect(wf).toContain('- main');
  });

  it('supports a configurable publish branch', () => {
    const wf = generatePublishWorkflow(makeConfig({ publishBranch: 'docs/site' }));
    expect(wf).toContain('branches:');
    expect(wf).toContain('- docs/site');
    expect(wf).not.toContain('- main');
  });

  it('supports configurable docs dir via vars.NRDOCS_DOCS_DIR', () => {
    const wf = generatePublishWorkflow(config);
    expect(wf).toContain('vars.NRDOCS_DOCS_DIR');
  });

  it('defaults docs dir to the configured docsDir', () => {
    const wf = generatePublishWorkflow(makeConfig({ docsDir: 'my-docs' }));
    expect(wf).toContain("vars.NRDOCS_DOCS_DIR || 'my-docs'");
  });
});

describe('checkExistingFile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns missing when file does not exist', () => {
    const result = checkExistingFile(join(TEST_DIR, 'nonexistent.yml'), 'content');
    expect(result).toBe('missing');
  });

  it('returns identical when file content matches', () => {
    const filePath = join(TEST_DIR, 'test.yml');
    writeFileSync(filePath, 'slug: test\n');
    expect(checkExistingFile(filePath, 'slug: test\n')).toBe('identical');
  });

  it('returns differs when file content is different', () => {
    const filePath = join(TEST_DIR, 'test.yml');
    writeFileSync(filePath, 'slug: old\n');
    expect(checkExistingFile(filePath, 'slug: new\n')).toBe('differs');
  });
});

describe('validateExistingProjectYml', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns false when file does not exist', () => {
    expect(validateExistingProjectYml(TEST_DIR)).toBe(false);
  });

  it('returns true for valid project.yml with slug and title', () => {
    writeFileSync(join(TEST_DIR, 'project.yml'), 'slug: test\ntitle: Test\n');
    expect(validateExistingProjectYml(TEST_DIR)).toBe(true);
  });

  it('returns false when slug is missing', () => {
    writeFileSync(join(TEST_DIR, 'project.yml'), 'title: Test\n');
    expect(validateExistingProjectYml(TEST_DIR)).toBe(false);
  });

  it('returns false when title is missing', () => {
    writeFileSync(join(TEST_DIR, 'project.yml'), 'slug: test\n');
    expect(validateExistingProjectYml(TEST_DIR)).toBe(false);
  });

  it('returns false for invalid YAML', () => {
    writeFileSync(join(TEST_DIR, 'project.yml'), 'key: [\ninvalid unclosed');
    expect(validateExistingProjectYml(TEST_DIR)).toBe(false);
  });

  it('returns false for scalar YAML', () => {
    writeFileSync(join(TEST_DIR, 'project.yml'), 'just a string');
    expect(validateExistingProjectYml(TEST_DIR)).toBe(false);
  });
});

describe('validateExistingNavYml', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns false when file does not exist', () => {
    expect(validateExistingNavYml(TEST_DIR)).toBe(false);
  });

  it('returns true for valid YAML', () => {
    writeFileSync(join(TEST_DIR, 'nav.yml'), 'nav:\n  - label: Home\n    path: home\n');
    expect(validateExistingNavYml(TEST_DIR)).toBe(true);
  });

  it('returns false for invalid YAML', () => {
    writeFileSync(join(TEST_DIR, 'nav.yml'), 'key: [\ninvalid unclosed');
    expect(validateExistingNavYml(TEST_DIR)).toBe(false);
  });
});

describe('validateExistingWorkflow', () => {
  const workflowDir = join('.github', 'workflows');
  const workflowPath = join(workflowDir, 'publish-docs.yml');
  let workflowExistedBefore: boolean;
  let originalContent: string | null = null;

  beforeEach(() => {
    workflowExistedBefore = existsSync(workflowPath);
    if (workflowExistedBefore) {
      originalContent = require('node:fs').readFileSync(workflowPath, 'utf-8');
    }
    mkdirSync(workflowDir, { recursive: true });
  });

  afterEach(() => {
    if (workflowExistedBefore && originalContent !== null) {
      writeFileSync(workflowPath, originalContent);
    } else if (!workflowExistedBefore && existsSync(workflowPath)) {
      require('node:fs').unlinkSync(workflowPath);
    }
  });

  it('returns true when workflow contains all required references', () => {
    writeFileSync(
      workflowPath,
      '/oidc/publish-credentials\nACTIONS_ID_TOKEN_REQUEST_URL\nX-Repo-Identity\n',
    );
    expect(validateExistingWorkflow()).toBe(true);
  });

  it('returns false when OIDC exchange call is missing', () => {
    writeFileSync(workflowPath, 'ACTIONS_ID_TOKEN_REQUEST_URL\nX-Repo-Identity\n');
    expect(validateExistingWorkflow()).toBe(false);
  });

  it('returns false when X-Repo-Identity is missing', () => {
    writeFileSync(workflowPath, '/oidc/publish-credentials\nACTIONS_ID_TOKEN_REQUEST_URL\n');
    expect(validateExistingWorkflow()).toBe(false);
  });
});
