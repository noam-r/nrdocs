import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Version from bundled banner, or repo package.json when running from source (tsx). */
export function getCliVersion(): string {
  const g = globalThis as Record<string, unknown>;
  const embedded = g['__NRDOCS_CLI_VERSION__'];
  if (typeof embedded === 'string' && embedded.length > 0) {
    return embedded;
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoPkg = join(here, '..', '..', '..', 'package.json');
    if (existsSync(repoPkg)) {
      const v = (JSON.parse(readFileSync(repoPkg, 'utf8')) as { version?: string }).version;
      if (v) return v;
    }
  } catch {
    /* ignore */
  }
  return 'dev';
}

/** One-line hint when invoked with no arguments (distinct from full --help). */
export function printBriefUsage(): void {
  console.log(`nrdocs CLI ${getCliVersion()}

For docs repo owners:
  nrdocs import mkdocs
  nrdocs init --token '<your-token>'
  nrdocs password set
  nrdocs password enable
  nrdocs password disable
  nrdocs upgrade
  nrdocs status
  git push   # publish after init via the generated GitHub Actions workflow

Platform operators only:
  nrdocs admin --help

Run nrdocs --help for details.`);
}

export function printHelp(): void {
  const help = `nrdocs CLI ${getCliVersion()}

What are you trying to do?

1. Set up a documentation repo (repo owner)

   nrdocs init --token <bootstrap-token>

   Run this once from the repo you want to publish. It creates the docs files,
   registers the project, writes the publish workflow, and local status metadata.
   Publishing uses GitHub Actions OIDC by default (no per-repo secrets/variables).

2. Convert an existing docs platform (repo owner)

   nrdocs import mkdocs

   Converts local files only. After importing, run nrdocs init with your
   bootstrap token to create the remote project and generate the publish workflow.

3. Publish documentation (repo owner)

   git push

   There is no local "nrdocs publish" command for repo owners. After init,
   publishing happens from the generated GitHub Actions workflow on push.

4. Check setup and publish status (repo owner)

   nrdocs status

   Shows whether this repo has been initialized, whether the Control Plane
   project is approved, whether a publish exists, and the docs URL.

5. Upgrade generated workflow for an already-onboarded repo (repo owner)

   nrdocs upgrade

   Refreshes .github/workflows/publish-docs.yml from .nrdocs/status.json.
   Does not require a bootstrap token and does not call the Control Plane.

6. Operate the platform (platform operator only)

   nrdocs admin <command>

   Requires NRDOCS_API_KEY. Operators create bootstrap tokens with
   nrdocs admin init; repo owners should not use admin commands.

Commands:
  init --token <token>   Set up this docs repo for publishing
  import <platform>      Convert existing docs into nrdocs files (mkdocs supported)
  password <subcommand>  Manage password protection (set|enable|disable)
  upgrade                Refresh generated workflow for an onboarded repo
  status                 Show local setup and Control Plane publish status
  admin <command>        Platform operator tasks only (see nrdocs admin --help)
  --help, -h             Show this help message
  --version, -v          Show the installed version

Run nrdocs init --help for init-specific flags.
Run nrdocs import --help for importers.
Run nrdocs admin --help only if you operate the nrdocs platform.`;

  console.log(help);
}

export function printInitHelp(): void {
  const help = `Usage: nrdocs init --token <token> [options]

Set up this documentation repo for publishing using a bootstrap token.

Run this once from the repo you want to publish. After init succeeds, publish
by pushing to GitHub; the generated workflow performs the publish.

Flags:
  --token <token>              Bootstrap token issued by your organization admin (required)
  --slug <value>               Project slug (for non-interactive use)
  --title <value>              Project title (for non-interactive use)
  --repo-identity <value>      Repository identity in format github.com/owner/repo (for non-interactive use)
  --docs-dir <value>           Documentation directory (default: docs)
  --access-mode <value>        Reader access mode: public or password (default: public)
  --publish-branch <value>     Git branch that triggers publishing (default: current branch, fallback: main)
  --description <value>        Project description
  --overwrite-scaffold         Overwrite existing generated files (project.yml, nav.yml, publish-docs.yml) when they differ
  --help, -h                   Show this help message`;

  console.log(help);
}

export function printVersion(): void {
  console.log(getCliVersion());
}

export function printUnknownCommand(cmd: string): void {
  if (cmd === 'publish') {
    console.error(
      'There is no local `nrdocs publish` command for docs repo owners.\n' +
        'Run `nrdocs init --token <bootstrap-token>` once, then publish with `git push`.\n' +
        'Platform operators doing a manual publish can run: nrdocs admin publish',
    );
    return;
  }

  console.error(
    `Unknown command '${cmd}'. Supported commands: init, import, status, admin, plus --help / --version.\n` +
      'Run: nrdocs --help',
  );
}
