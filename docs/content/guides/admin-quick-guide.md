# Admin quick guide

This page is the short operator cheat sheet. It is for **platform operators**, not documentation repo owners.

Repo owners normally run:

```bash
nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
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

1. Operator registers the project from a docs repo checkout (or with `NRDOCS_DOCS_DIR` pointing at the docs directory):

   ```bash
   nrdocs admin register
   ```

2. Operator approves it (and mints an initial publish token for manual operator publishing if needed):

   ```bash
   nrdocs admin approve <project-id> --repo-identity github.com/org/repo
   ```

3. Operator gives the repo owner the **Control Plane URL** and the **project id** (not secrets).
4. Repo owner runs:

   ```bash
   nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>'
   git push
   ```

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
