export const CLI_VERSION = '2.0.0' as const;
export const CLI_PACKAGE = 'nrdocs' as const;

export const ROOT_HELP = `nrdocs ${CLI_VERSION}

Publish a Markdown directory as a protected Cloudflare minisite.

Publisher commands:
  nrdocs connect [directory] [--title <title>]
  nrdocs publish [directory]
  nrdocs preview [directory]
  nrdocs generate nav [directory] [--title <title>] [--dry-run] [--force]
  nrdocs credentials list
  nrdocs credentials remove <site-id>

Administrative commands:
  nrdocs deploy [--domain <hostname>] [--instance <instance-id>]
  nrdocs instance list
  nrdocs instance show [instance-id]
  nrdocs instance use <instance-id>
  nrdocs site create <slug>
  nrdocs site list
  nrdocs site show <slug>
  nrdocs site access <slug> public|password
  nrdocs site password change <slug>
  nrdocs site enable <slug>
  nrdocs site disable <slug>
  nrdocs site rename <old-slug> <new-slug>
  nrdocs site delete <slug>
  nrdocs token issue <slug> --name <name> [--ttl <duration>]
  nrdocs token list <slug>
  nrdocs token revoke <slug> <name-or-token-id>

Global options:
  --help       Show help
  --version    Show version
  --json       Machine-readable output (list/show commands)
  --instance   One-command administrative instance override

`;

export const REMOVED_1X_COMMANDS = [
  'init',
  'repos',
  'status',
  'approve',
  'access set',
  'password set',
  'password allow',
  'password disallow',
  'rules',
  'auth login',
  'auth status',
  'auth logout',
  'profiles',
  'config show',
  'doctor',
  'nav generate',
] as const;
