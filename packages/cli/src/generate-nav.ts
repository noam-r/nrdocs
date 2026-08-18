import {
  generateNavigationEntries,
  serializeNrdocsYaml,
  formatNavigationPreview,
} from '@nrdocs/renderer';
import { parseNrdocsConfig } from '@nrdocs/contracts';
import type { CommandContext } from './command-context.js';
import { parseFlags } from './argv.js';
import { resolveGenerateNavDirectory, configPathFor, loadNrdocsConfig } from './config.js';
import { localValidationError, usageError, ioError } from './errors.js';
import { presentHumanSuccess } from './present.js';
import { atomicWriteProjectFile, assertRealDirectory } from './fs-safe.js';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';

function isRendererFailure(error: unknown): error is Error & { code?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'RendererError'
  );
}

export async function runGenerateNavCommand(
  ctx: CommandContext,
  args: readonly string[],
): Promise<void> {
  if (ctx.help) {
    presentHumanSuccess(
      ctx.runtime,
      'nrdocs generate nav [directory] [--title <title>] [--dry-run] [--force]\n',
    );
    return;
  }
  if (ctx.json) throw usageError('generate nav does not support --json.');

  const { flags, positionals } = parseFlags(args, {
    boolean: ['--dry-run', '--force'],
    string: ['--title'],
  });
  if (positionals.length > 1) {
    throw usageError('generate nav accepts at most one directory argument.');
  }

  const dryRun = Boolean(flags['--dry-run']);
  const force = Boolean(flags['--force']);
  const titleFlag = flags['--title'];
  const directoryArg = positionals[0];

  const root = await resolveGenerateNavDirectory(ctx.runtime, directoryArg);
  await assertRealDirectory(ctx.runtime, root);
  const configPath = configPathFor(root);

  let existing = null as Awaited<ReturnType<typeof loadNrdocsConfig>>['config'] | null;
  let configExists = false;
  try {
    const loaded = await loadNrdocsConfig(ctx.runtime, root);
    existing = loaded.config;
    configExists = true;
  } catch (error) {
    if (!(error instanceof Error) || !/nrdocs\.yml was not found/.test(error.message)) {
      throw error;
    }
  }

  if (
    existing &&
    existing.navigation !== 'auto' &&
    Array.isArray(existing.navigation) &&
    !force &&
    !dryRun
  ) {
    throw localValidationError(
      `Explicit navigation already exists in:\n  ${configPath}\n\nRe-run with --force to replace it, or --dry-run to preview.`,
    );
  }

  let entries;
  try {
    entries = await generateNavigationEntries(root);
  } catch (error) {
    if (isRendererFailure(error)) {
      throw localValidationError(error.message);
    }
    throw error;
  }

  let title: string;
  if (typeof titleFlag === 'string') {
    try {
      title = parseNrdocsConfig({ title: titleFlag, navigation: 'auto' }).title;
    } catch {
      throw localValidationError('Invalid --title value.');
    }
  } else if (existing) {
    title = existing.title;
  } else {
    if (!ctx.runtime.stdinIsTTY || !ctx.runtime.stdoutIsTTY) {
      throw usageError(
        'A title is required when creating nrdocs.yml.\nPass --title <title>, or run interactively.',
      );
    }
    const entered = (await ctx.terminal.promptLine('Site title:')).trim();
    try {
      title = parseNrdocsConfig({ title: entered, navigation: 'auto' }).title;
    } catch {
      throw localValidationError('Invalid title.');
    }
  }

  const language = existing?.language ?? 'und';
  const direction = existing?.direction ?? 'auto';
  const publish = existing?.publish;

  const preview = formatNavigationPreview(entries);
  if (dryRun) {
    presentHumanSuccess(
      ctx.runtime,
      `Proposed navigation for:\n  ${root}\n\n${preview}\n\n(dry run — nothing written)`,
    );
    return;
  }

  const yamlText = serializeNrdocsYaml(
    {
      title,
      language,
      direction,
      navigation: entries,
      ...(publish ? { publish } : {}),
    },
    entries,
  );

  try {
    parseNrdocsConfig(parseYaml(yamlText));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid config';
    throw localValidationError(`Generated nrdocs.yml failed validation (${msg}).`);
  }

  try {
    await atomicWriteProjectFile(ctx.runtime, configPath, yamlText, 0o644);
  } catch (error) {
    if (error instanceof Error && /symbolic-link|Failed to write/.test(error.message)) throw error;
    throw ioError(`Unable to write:\n  ${configPath}`);
  }

  presentHumanSuccess(
    ctx.runtime,
    `${configExists ? 'Updated' : 'Created'} ${path.basename(configPath)} with explicit navigation.\n\n${preview}`,
  );
}
