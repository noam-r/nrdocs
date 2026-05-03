import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CLI argv routing (main.ts)', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.resetModules();
  });

  async function runMainWithArgv(argv: string[]): Promise<void> {
    process.argv = ['node', 'nrdocs', ...argv];
    vi.resetModules();
    await import('./main');
    // `main.ts` uses dynamic imports for some subcommands (e.g. import/status).
    // Allow extra time for module transform/load in CI and cold runs.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  it('no args prints brief usage (not full help)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMainWithArgv([]);
    expect(log).toHaveBeenCalled();
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('nrdocs CLI');
    expect(out).toContain('nrdocs init');
    expect(out).toContain('config set api-url');
    expect(out).toContain('git push');
    expect(out).toContain('nrdocs --help');
    expect(out).not.toContain('Show the installed version');
    log.mockRestore();
  }, 20000);

  it('--help as first arg prints full help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMainWithArgv(['--help']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('nrdocs CLI');
    expect(out).toContain('Show the installed version');
    expect(out).toContain('init');
    expect(out).toContain('--repo-id');
    expect(out).toContain('password <subcommand>');
    expect(out).toContain('upgrade');
    expect(out).toContain('status');
    expect(out).toContain('There is no local "nrdocs publish"');
    log.mockRestore();
  });

  it('publish explains repo-owner publishing path', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runMainWithArgv(['publish']);
    expect(err).toHaveBeenCalled();
    const out = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('There is no local `nrdocs publish`');
    expect(out).toContain('git');
    expect(process.exitCode).toBe(1);
    err.mockRestore();
  });

  it('admin --help prints operator help (not global help)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runMainWithArgv(['admin', '--help']);
    expect(log).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('nrdocs admin');
    expect(out).toContain('register');
    log.mockRestore();
    err.mockRestore();
  });

  it('import --help prints importer help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMainWithArgv(['import', '--help']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('Usage: nrdocs import <platform>');
    expect(out).toContain('mkdocs');
    log.mockRestore();
  });

  it('import mkdocs --help prints MkDocs importer help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMainWithArgv(['import', 'mkdocs', '--help']);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('Usage: nrdocs import mkdocs');
    expect(out).toContain('--mkdocs-file');
    log.mockRestore();
  });

  it('unknown import platform lists available importers', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runMainWithArgv(['import', 'unknown']);
    const out = err.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain("Unknown import platform 'unknown'");
    expect(out).toContain('Available importers: mkdocs');
    expect(process.exitCode).toBe(1);
    err.mockRestore();
  });
});
