import { printHelp, printVersion, printUnknownCommand } from './commands/help';
import { runInit } from './commands/init';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  printVersion();
} else if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  printHelp();
} else if (args[0] === 'init') {
  await runInit(args.slice(1));
} else {
  printUnknownCommand(args[0]);
  process.exitCode = 1;
}
