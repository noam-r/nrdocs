# Admin quick guide

This page is the short operator cheat sheet. It is for **platform operators**, not documentation repo owners.

Repo owners normally run:

```bash
nrdocs init --token '<bootstrap-token>'
git push
```

They should not need `nrdocs admin` or `NRDOCS_API_KEY`.

## Operator setup

Use shell variables or a private, uncommitted `.env` in an operator-only workspace:

```bash
export NRDOCS_API_URL='https://<control-plane-worker>'
export NRDOCS_API_KEY='<operator-api-key>'
```

Never commit `.env`. Never put `NRDOCS_API_KEY` in a documentation repository workflow.

## Common commands

```bash
nrdocs admin init --org default
```

Create a bootstrap token for repo-owner onboarding. Send the printed token to the repo owner over a secure channel; they run `nrdocs init --token '<bootstrap-token>'` from their docs repo.

```bash
nrdocs admin list
nrdocs admin list --all
nrdocs admin list --status awaiting_approval
nrdocs admin list --name customer
```

List projects. By default this shows **approved** projects only; use `--all` or `--status` for other lifecycle states.

```bash
nrdocs admin status <project-id>
```

Show a project.

```bash
nrdocs admin approve <project-id> --repo-identity github.com/org/repo
```

Approve a registered project. If the project already has `repo_identity`, you can omit `--repo-identity`.

```bash
nrdocs admin disable <project-id>
```

Take a project offline for readers. Data is preserved.

```bash
nrdocs admin set-password <project-id>
```

Set or update the password for a password-protected project.

## Recommended onboarding

1. Operator runs `nrdocs admin init --org default` from an operator workspace.
2. Repo owner runs `nrdocs init --token '<bootstrap-token>'` from their repository.
3. Repo owner pushes to the configured publish branch.

This path creates the project, writes the GitHub Actions workflow, and uses OIDC-based publishing (no per-repo secrets/variables), while avoiding sharing the admin API key with repo owners.

## Manual operator path

Use this only for operator-managed projects or recovery.

```bash
# Run from the docs repo root, or set NRDOCS_DOCS_DIR=/path/to/docs
nrdocs admin register
nrdocs admin approve <project-id> --repo-identity github.com/org/repo
# Put the printed NRDOCS_PUBLISH_TOKEN in private .env, then:
nrdocs admin publish <project-id>
```

`nrdocs admin publish` uses `NRDOCS_PUBLISH_TOKEN`, not `NRDOCS_API_KEY`.

`nrdocs admin mint-publish-token <project-id>` still exists for token rotation or recovery. Use `nrdocs admin approve <project-id> --no-mint-publish-token` only when you intentionally want an approved project without minting a publish token.

## CLI version

The same quick guide is available in the terminal:

```bash
nrdocs admin quick-guide
```
