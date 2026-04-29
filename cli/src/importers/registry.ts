import { CliUsageError } from '../cli-usage-error';
import { mkdocsImporter } from './mkdocs';
import type { ImportContext, Importer } from './types';

const IMPORTERS: Importer[] = [
  mkdocsImporter,
];

export function listImporters(): Importer[] {
  return IMPORTERS;
}

export function getImporter(name: string): Importer | undefined {
  return IMPORTERS.find((importer) => importer.name === name);
}

export async function runImporter(platform: string, args: string[], cwd = process.cwd()): Promise<void> {
  const importer = getImporter(platform);
  if (!importer) {
    throw new CliUsageError(
      `Unknown import platform '${platform}'. Available importers: ${IMPORTERS.map((i) => i.name).join(', ')}`,
    );
  }

  const context: ImportContext = { cwd };
  const result = await importer.run(context, args);

  if (result.generatedFiles.length > 0) {
    console.log('\nGenerated files:');
    for (const file of result.generatedFiles) {
      console.log(`  ${file}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (result.nextSteps.length > 0) {
    console.log('\nNext steps:');
    for (const [idx, step] of result.nextSteps.entries()) {
      console.log(`  ${idx + 1}. ${step}`);
    }
  }
}
