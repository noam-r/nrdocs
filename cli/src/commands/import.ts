import { CliUsageError } from '../cli-usage-error';
import { listImporters, runImporter } from '../importers/registry';

export function printImportHelp(): void {
  console.log(`Usage: nrdocs import <platform> [options]

Convert documentation from another platform into nrdocs local files.
Importers may create a generated branch so converted docs do not duplicate the
source docs tree on your main development branch.

Available importers:
${listImporters().map((i) => `  ${i.name.padEnd(10)} ${i.summary}`).join('\n')}

Examples:
  nrdocs import mkdocs
  nrdocs import mkdocs --branch nrdocs --out-dir docs

Run nrdocs import <platform> --help for platform-specific options.`);
}

export async function runImport(args: string[]): Promise<void> {
  const platform = args[0];
  if (!platform || platform === '--help' || platform === '-h' || platform === 'help') {
    printImportHelp();
    return;
  }

  const importer = listImporters().find((i) => i.name === platform);
  if (args.includes('--help') || args.includes('-h')) {
    if (!importer) {
      throw new CliUsageError(
        `Unknown import platform '${platform}'. Available importers: ${listImporters().map((i) => i.name).join(', ')}`,
      );
    }
    importer.printHelp();
    return;
  }

  await runImporter(platform, args.slice(1));
}
