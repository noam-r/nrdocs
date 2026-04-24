declare const CLI_VERSION: string;

export function printHelp(): void {
  const help = `Usage: nrdocs <command> [options]

Commands:
  init --token <token>   Register a project under an organization
  --help, -h             Show this help message
  --version, -v          Show the installed version

Run 'nrdocs <command> --help' for command-specific usage.`;

  console.log(help);
}

export function printInitHelp(): void {
  const help = `Usage: nrdocs init --token <token> [options]

Register a project under an organization using a bootstrap token.

Flags:
  --token <token>              Bootstrap token issued by your organization admin (required)
  --slug <value>               Project slug (for non-interactive use)
  --title <value>              Project title (for non-interactive use)
  --repo-identity <value>      Repository identity in format github.com/owner/repo (for non-interactive use)
  --docs-dir <value>           Documentation directory (default: docs)
  --description <value>        Project description
  --help, -h                   Show this help message`;

  console.log(help);
}

export function printVersion(): void {
  console.log(CLI_VERSION);
}

export function printUnknownCommand(cmd: string): void {
  console.error(`Error: Unknown command '${cmd}'. Run 'nrdocs --help' for usage.`);
}
