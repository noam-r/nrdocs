import { getCliVersion } from './version.js';
import { runCommand } from './commands/index.js';

const args = process.argv.slice(2);
const version = getCliVersion();

if (args.includes('--version') || args.includes('-v')) {
  console.log(`nrdocs ${version}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`nrdocs ${version}

Usage:
  nrdocs <command> [options]

Repo-owner commands:
  init        Initialize nrdocs in a GitHub repository
  publish     Build and upload docs artifacts
  doctor      Diagnose setup and connectivity (--ci for Actions)
  nav         Navigation helpers (generate)

Operator commands:
  deploy      Deploy or update nrdocs infrastructure
  auth        Manage operator credentials (login, status, logout)
  repos       List known repos
  approve     Approve a repo for serving
  disable     Disable serving for a repo
  access      Change access mode
  password    Manage passwords (set | allow | disallow)
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
