# Importing MkDocs

Use `nrdocs import mkdocs` when you already have a MkDocs repository and want to convert it into the nrdocs layout.

The importer is **convert-only**. It does not create a remote project, mint tokens, or write GitHub secrets. It creates or switches to a generated branch, `nrdocs` by default, so the converted nrdocs files do not live beside the original MkDocs source on your normal development branch.

## Basic flow

```bash
nrdocs import mkdocs
nrdocs init --api-url '<control-plane-url>' --repo-id '<repo-id>' --docs-dir docs
git add .
git commit -m "Import docs into nrdocs"
git push -u origin nrdocs
```

By default, the importer reads `mkdocs.yml` on your current branch, snapshots the MkDocs docs directory, creates or switches to a `nrdocs` branch, and writes the generated nrdocs source under `docs/` on that branch.

After `git push -u origin nrdocs`, GitHub may show a “create pull request” suggestion. That PR is optional and is not part of the publish flow. The generated workflow is configured to run on pushes to the `nrdocs` branch, so publishing does not require merging `nrdocs` back into `main`.

When you run `nrdocs init` after the import, the **Publish branch** prompt means “which Git branch should trigger the GitHub Actions publish workflow?” Because the importer switches you to the generated branch, the default should be `nrdocs`. Use `main` only if you intentionally want publishing to happen from `main`.

Do not merge the `nrdocs` branch into your development branch unless you intentionally want generated nrdocs files there. For normal MkDocs migration, keep editing MkDocs on the development branch, rerun `nrdocs import mkdocs --force` when you want to refresh the generated branch, then commit and push `nrdocs` again.

## What gets generated

- `<out-dir>/project.yml`
- `<out-dir>/nav.yml`
- `<out-dir>/content/**`, copied from the MkDocs `docs_dir`
- `.github/workflows/publish-docs.yml`

The workflow publishes from the generated branch and reads docs from the importer output directory. It authenticates using **GitHub Actions OIDC** and does not require per-repo secrets/variables for publishing.

Because import is local-only, you still need to run `nrdocs init` after import to write the workflow and local metadata for the operator-approved project.

## Options

```bash
nrdocs import mkdocs \
  --mkdocs-file mkdocs.yml \
  --branch nrdocs \
  --out-dir docs \
  --accept-unsupported-customizations \
  --slug my-docs \
  --title "My Docs"
```

Useful flags:

- `--mkdocs-file <path>`: read a different MkDocs config file.
- `--docs-dir <path>`: override `docs_dir` from `mkdocs.yml`.
- `--branch <branch>`: choose the generated nrdocs branch, default `nrdocs`.
- `--out-dir <path>`: choose the generated nrdocs directory on that branch, default `docs`.
- `--publish-branch <branch>`: choose the branch that triggers publishing, defaulting to `--branch`.
- `--slug`, `--title`, `--description`: override inferred project metadata.
- `--accept-unsupported-customizations`: continue when MkDocs customizations cannot be imported.
- `--force`: switch to an existing target branch and overwrite generated files that differ.

## Safety rules

The importer requires a clean git worktree before switching branches. It never moves or deletes MkDocs files on your source branch. If the target branch already exists, it stops unless you pass `--force`.

Some MkDocs features do not have a direct nrdocs equivalent. The importer warns for plugins, theme settings, extra CSS/JavaScript, and markdown extensions so you can review the generated result.

If `mkdocs.yml` contains customizations such as `theme`, `theme.custom_dir`, `plugins`, redirects, `extra_css`, or `extra_javascript`, the importer asks for explicit approval before it switches branches or writes files. In non-interactive use, pass `--accept-unsupported-customizations` to acknowledge that those elements will not be imported.
