#!/usr/bin/env node
import { ExitCode } from '@nrdocs/contracts';
import { CliError } from './errors.js';
import { assertSupportedNode } from './runtime.js';

try {
  assertSupportedNode();
} catch (error) {
  if (error instanceof CliError) {
    let text = error.safe_message;
    if (error.remediation) text += `\n\n${error.remediation}`;
    process.stderr.write(`${text}\n`);
    process.exit(error.exit_code);
  }
  throw error;
}

function exitInterrupted(): void {
  process.stderr.write('\n');
  process.exit(ExitCode.Interrupted);
}

process.once('SIGINT', exitInterrupted);
process.once('SIGTERM', exitInterrupted);

void import('./index.js')
  .then(({ runCli }) => runCli(process.argv.slice(2)))
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message && !/nrd_pub_|Bearer\s/i.test(message)) {
      process.stderr.write(`${message}\n`);
    }
    process.exit(1);
  });
