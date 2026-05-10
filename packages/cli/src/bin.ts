import { NRDOCS_VERSION } from '@nrdocs/shared';
import { runCommand } from './commands/index.js';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(`nrdocs ${NRDOCS_VERSION}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`nrdocs ${NRDOCS_VERSION}

Usage:
  nrdocs <command> [options]

Repo-owner commands:
  init        Initialize nrdocs in a GitHub repository
  publish     Build and upload docs artifacts
  doctor      Diagnose setup and connectivity

Operator commands:
  deploy      Deploy or update nrdocs infrastructure
  auth        Manage operator credentials (login, status, logout)
  repos       List known repos
  approve     Approve a repo for serving
  disable     Disable serving for a repo
  access      Change access mode
  password    Set or rotate password
  rules       Manage auto-approval rules
  status      Show repo status
  config      Show configuration
  profiles    Manage profiles

Options:
  --help      Show help
  --version   Show version
  --json      Output as JSON
`);
  process.exit(0);
}

runCommand(args).catch((err: unknown) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
