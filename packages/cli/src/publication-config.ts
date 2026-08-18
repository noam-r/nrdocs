import { parse as parseYaml } from 'yaml';
import {
  normalizeTitle,
  parseNrdocsConfig,
  type NavigationEntry,
  type NrdocsConfig,
  type SiteId,
} from '@nrdocs/contracts';
import { serializeNrdocsYaml } from '@nrdocs/renderer';
import type { CommandContext } from './command-context.js';
import { configPathFor, loadNrdocsConfig } from './config.js';
import { ioError, localValidationError, usageError } from './errors.js';
import { atomicWriteProjectFile } from './fs-safe.js';

export async function tryLoadPublicationConfig(
  ctx: CommandContext,
  root: string,
): Promise<{ path: string; config: NrdocsConfig } | null> {
  try {
    const loaded = await loadNrdocsConfig(ctx.runtime, root);
    return { path: loaded.path, config: loaded.config };
  } catch (error) {
    if (error instanceof Error && /nrdocs\.yml was not found/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function resolvePublicationTitle(input: {
  existing: NrdocsConfig | null;
  titleFlag: string | undefined;
  interactive: boolean;
  prompt: () => Promise<string>;
}): Promise<string> {
  const existingTitle = input.existing?.title;
  if (typeof input.titleFlag === 'string') {
    const normalized = normalizeTitle(input.titleFlag);
    if (!normalized) throw localValidationError('Invalid --title value.');
    if (existingTitle && existingTitle !== normalized) {
      throw localValidationError(
        `Site title already set to:\n  ${existingTitle}\n\nEdit nrdocs.yml directly to change it.`,
      );
    }
    return existingTitle ?? normalized;
  }
  if (existingTitle) return existingTitle;
  if (!input.interactive) {
    throw usageError(
      'A title is required when creating or completing nrdocs.yml.\nPass --title <title>.',
    );
  }
  const entered = (await input.prompt()).trim();
  const normalized = normalizeTitle(entered);
  if (!normalized) throw localValidationError('Invalid title.');
  return normalized;
}

export async function writeConnectedNrdocsYml(
  ctx: CommandContext,
  root: string,
  input: { existing: NrdocsConfig | null; siteId: SiteId; title: string },
): Promise<NrdocsConfig> {
  const configPath = configPathFor(root);
  const language = input.existing?.language ?? 'und';
  const direction = input.existing?.direction ?? 'auto';
  const navigation = input.existing?.navigation === undefined ? 'auto' : input.existing.navigation;

  const nextConfig: NrdocsConfig = {
    publish: { credential: input.siteId },
    title: input.title,
    language,
    direction,
    navigation: navigation === undefined ? 'auto' : navigation,
  };

  const yamlText = Array.isArray(nextConfig.navigation)
    ? serializeNrdocsYaml(nextConfig, nextConfig.navigation)
    : serializeNrdocsYaml({ ...nextConfig, navigation: 'auto' });

  try {
    parseNrdocsConfig(parseYaml(yamlText), { requireCredential: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid config';
    throw localValidationError(`Proposed nrdocs.yml failed validation (${msg}).`);
  }

  try {
    await atomicWriteProjectFile(ctx.runtime, configPath, yamlText, 0o644);
  } catch (error) {
    if (error instanceof Error && /symbolic-link|Failed to write/.test(error.message)) throw error;
    throw ioError(`Unable to write:\n  ${configPath}`);
  }

  return nextConfig;
}

export async function writeExplicitNavigationYml(
  ctx: CommandContext,
  root: string,
  config: NrdocsConfig,
  entries: NavigationEntry[],
): Promise<NrdocsConfig> {
  const configPath = configPathFor(root);
  const nextConfig: NrdocsConfig = {
    ...config,
    navigation: entries,
  };
  const yamlText = serializeNrdocsYaml(nextConfig, entries);

  try {
    parseNrdocsConfig(parseYaml(yamlText));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'invalid config';
    throw localValidationError(`Proposed nrdocs.yml failed validation (${msg}).`);
  }

  try {
    await atomicWriteProjectFile(ctx.runtime, configPath, yamlText, 0o644);
  } catch (error) {
    if (error instanceof Error && /symbolic-link|Failed to write/.test(error.message)) throw error;
    throw ioError(`Unable to write:\n  ${configPath}`);
  }

  return nextConfig;
}
