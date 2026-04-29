import { CliUsageError } from './cli-usage-error';
import { printBriefUsage, printHelp, printVersion, printUnknownCommand } from './commands/help';
import { runAdmin } from './commands/admin';
import { runInit } from './commands/init';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printBriefUsage();
    return;
  }

  const first = args[0];

  if (first === '--version' || first === '-v') {
    printVersion();
    return;
  }

  if (first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    return;
  }

  if (first === 'init') {
    await runInit(args.slice(1));
    return;
  }

  if (first === 'import') {
    const { runImport } = await import('./commands/import');
    await runImport(args.slice(1));
    return;
  }

  if (first === 'status') {
    const { runStatus } = await import('./commands/status');
    await runStatus(args.slice(1));
    return;
  }

  if (first === 'upgrade') {
    const { runUpgrade } = await import('./commands/upgrade');
    await runUpgrade(args.slice(1));
    return;
  }

  if (first === 'password') {
    const { runPassword } = await import('./commands/password');
    await runPassword(args.slice(1));
    return;
  }

  if (first === 'admin') {
    await runAdmin(args.slice(1));
    return;
  }

  printUnknownCommand(first);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof CliUsageError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
