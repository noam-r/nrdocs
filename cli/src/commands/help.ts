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
  nrdocs config set api-url 'https://<control-plane-worker>'   # one-time setup (recommended)
  nrdocs init
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

   nrdocs config set api-url <control-plane-url>   # one-time (recommended)
   nrdocs init

   Run this once from the repo you want to publish. It creates the docs files,
   writes the publish workflow, and local status metadata.
   Publishing uses GitHub Actions OIDC by default (no per-repo secrets/variables).

2. Convert an existing docs platform (repo owner)

   nrdocs import mkdocs

   Converts local files only. After importing, run nrdocs init. API URL comes
   from your one-time config or environment. Optional: --repo-id if you link an existing project.

3. Publish documentation (repo owner)

   git push

   There is no local "nrdocs publish" command for repo owners. After init,
   publishing happens from the generated GitHub Actions workflow on push.

4. Check setup and publish status (repo owner)

   nrdocs status

   Shows whether this repo has been initialized, whether the Control Plane
   repo is approved, whether a publish exists, and the docs URL.

5. Upgrade generated workflow for an already-onboarded repo (repo owner)

   nrdocs upgrade

   Refreshes .github/workflows/publish-docs.yml from .nrdocs/status.json.
   Does not require a bootstrap token and does not call the Control Plane.

6. Operate the platform (platform operator only)

   nrdocs admin <command>

   Requires NRDOCS_API_KEY. Repo owners should not use admin commands.

Commands:
  init                   Set up this docs repo for publishing
  config                 Manage non-secret local CLI defaults (~/.nrdocs)
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
  const help = `Usage: nrdocs init [options]

Set up this documentation repo for publishing.

Typical flow:
  nrdocs config set api-url <control-plane-url>   # one-time (recommended)
  nrdocs init

No repo id is required: the first GitHub Actions run registers the site via OIDC
(project.yml + POST /oidc/register-project). Optional --repo-id records a UUID in
.nrdocs/status.json (operator-first setup or copied from Actions) for nrdocs status.

You can always override the default API URL per run:
  nrdocs init --api-url <control-plane-url>

Run this once from the repo you want to publish. After init succeeds, publish
by pushing to GitHub; the generated workflow performs the publish.

Flags:
  --api-url <url>              Control Plane URL (optional if set via nrdocs config → ~/.nrdocs/config.json or NRDOCS_API_URL)
  --repo-id <uuid>             Optional: link .nrdocs/status.json to an existing Control Plane project
  --project-id <uuid>          Same as --repo-id (alias)
  --slug <value>               Site slug (for non-interactive use)
  --title <value>              Site title (for non-interactive use)
  --repo-identity <value>      Repository identity in format github.com/owner/repo (for non-interactive use)
  --docs-dir <value>           Documentation directory (default: docs)
  --access-mode <value>        Reader access mode: public or password (default: password)
  --publish-branch <value>     Git branch that triggers publishing (default: current branch, fallback: main). If that branch does not exist locally, init creates it from HEAD and checks it out before writing files (or checks out origin/<branch> when that remote ref exists).
  --description <value>        Description
  --overwrite-scaffold         Overwrite existing generated files (project.yml, publish workflow) when they differ from generated scaffolding
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
        'Run `nrdocs init` once, then publish with `git push`.\n' +
        'Platform operators doing a manual publish can run: nrdocs admin publish',
    );
    return;
  }

  console.error(
    `Unknown command '${cmd}'. Supported commands: init, import, status, admin, plus --help / --version.\n` +
      'Run: nrdocs --help',
  );
}
