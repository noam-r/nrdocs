# Onboarding with a bootstrap token

This page is the **simple path** for using nrdocs once the platform is already running. You are **not** installing Workers, D1, or Wrangler here — someone on your team has already deployed the control plane and given you a **bootstrap token**. Your job is to wire a **fresh Git repository** so docs build and publish automatically.

If you are the person deploying the platform from zero, start with [Installation](../installation/index.html) first, then come back here for how your colleagues onboard.

---

## What you need

| Item | Why |
|------|-----|
| A **Git** repository on GitHub | The publish workflow and repo identity are GitHub-oriented today. |
| **`git`** on your machine | The CLI checks that you are inside a repo and reads `origin`. |
| A **bootstrap token** | A long secret string (a signed **JWT**, usually three segments separated by `.`) that your **platform operator** creates and sends you out-of-band (email, secret manager, ticket). It is **not** your GitHub password, **not** a GitHub PAT, and **not** the control plane admin API key. It only proves you may run `nrdocs init` for your org (within a repo quota). |
| The **`nrdocs` CLI** on your computer | A small program you install locally (see [Install the CLI](#install-the-cli)). After install, you must be able to type **`nrdocs`** in a terminal and have it run — if the terminal says **`command not found`**, follow the steps in that section (you do not need to know what “PATH” means to follow them). |
| GitHub Actions OIDC | The default publish workflow uses **OIDC** to authenticate to the Control Plane. No per-repo secrets or variables are required. |

You do **not** need the platform’s admin API key, `wrangler`, or Cloudflare access to your docs account.

---

## The flow in one minute

You do **two** things locally that the platform cannot do for you: install the **`nrdocs`** program on **your machine**, and obtain a **bootstrap token** from whoever runs your deployment (see below). After that, the steps are short.

**Why deployment does not install `nrdocs` for you**

Deploying nrdocs (Workers, D1, secrets) only updates **Cloudflare**. It does not — and should not — install software on every author’s laptop or on every company workstation. The author CLI is a separate **download** you (or your IT image) place on each machine that will run `nrdocs init`.

**Why the deployment script does not “add itself to `PATH`” for everyone**

`PATH` is a setting on **each** computer and **each** user account. The deployment script runs where **you** run it (often one operator machine or CI). It has no access to other people’s shells, home directories, or dotfiles — so it cannot configure their `PATH`.

Even for the **same** person who ran deploy: the script could try to append `export PATH=…` to `~/.bashrc` or `~/.zshrc`, but that is easy to get wrong (different shells, login vs non-login shells, corporate images that forbid editing profiles, duplicate lines, order relative to other tools). It is also a surprising side effect for a script whose job is to push Workers. So the project instead documents a **one-line** `PATH` change you choose to apply once, or `install.sh --system` for a standard system-wide location.

1. **Install the `nrdocs` program and check that your terminal can run it**

   Follow [Install the CLI](#install-the-cli). When **`nrdocs --help`** prints usage text, this step is done.

2. **Clone your docs repo**, `cd` into it, and ensure **`git remote origin`** points at the GitHub repository you will publish from (`git clone` does this automatically).

3. **Run init with your bootstrap token**

   ```bash
   nrdocs init --token '<paste-the-full-string-your-admin-sent>'
   ```

   The generated publish workflow runs on pushes to the **publish branch**. In interactive mode, `nrdocs init` defaults this to your current checked-out branch. If this repo uses a dedicated generated documentation branch, such as **`nrdocs`** after `nrdocs import mkdocs`, keep that value. If docs live on the default branch, use **`main`**.

   ```bash
   nrdocs init --token '<paste-the-full-string-your-admin-sent>' --publish-branch nrdocs
   ```

   **What that token is:** A **bootstrap token** is a signed credential your organization issues. The CLI sends it to the control plane; the server checks it and creates (or wires) your **project**. GitHub Actions publishing then uses **OIDC** to exchange for short-lived publish credentials on each run.

   **How to get one:** Ask the **person or team who deployed nrdocs** for your company (internal docs, DevOps, platform). They mint it against the live control plane with **`nrdocs admin init`**. There is no author self‑service “sign up for a token” in the default product. If **you** are that operator, use [For operators: issuing a bootstrap token](#for-operators-issuing-a-bootstrap-token) below.

4. **Commit** the generated files and **push to the branch your workflow uses**.

5. **GitHub Actions** runs the generated workflow; the control plane builds the site and your docs appear at the **Docs URL** printed by `nrdocs init`.

### Choosing `password` mode (recommended for private docs)

During `nrdocs init`, you will be asked for an **access mode**:

- `public` — anyone can read
- `password` — readers must login with a shared password

If you choose `password`, `nrdocs init` will also prompt you to **set the initial password** immediately. This prevents any “briefly public” window between first publish and password setup.

   For the default organization, the URL is:

   ```text
   https://<delivery-host>/<project-slug>/
   ```

   For a named organization, the URL is:

   ```text
   https://<delivery-host>/<org-slug>/<project-slug>/
   ```

   If the CLI prints `<delivery URL unavailable>`, ask your platform operator for the Delivery Worker URL. Operators should configure `DELIVERY_URL` on the Control Plane Worker so future `nrdocs init` runs can print the exact URL.

That is the entire “system tool” path for a new repo.

---

## Install the CLI

The installer copies one file named **`nrdocs`** into a folder on your computer. Your **terminal** only runs commands it can **find** in a built-in list of folders. If `nrdocs` landed in a folder that is **not** on that list, you will see **`command not found`** even though the file is there.

You only need **one** of the approaches below.

---

### Easiest for most people: install where the terminal already looks

This puts `nrdocs` in **`/usr/local/bin`**, which macOS and typical Linux setups already search. You may be asked for your **computer password** once (same idea as installing other system tools).

From the nrdocs repository root (or from the folder where you saved `install.sh`):

```bash
sudo sh install.sh --system
```

Then close the terminal window completely, open a **new** one, and run:

```bash
nrdocs --help
```

If you see help text, **stop here** — you do not need any other steps.

---

### If `install.sh` fails with “404” or “Failed to download”

That means **`install.sh` could not find a published GitHub Release** for the configured repository with a file named like **`nrdocs-linux-x64`** (or the macOS equivalent). Until those release assets exist, the script cannot download a native binary.

**Do this instead** from a **clone of the nrdocs repository** (Node.js **20 or newer** must be installed — check with `node --version`):

```bash
cd /path/to/nrdocs
npm install
npm run build:cli
```

That writes **`dist-cli/nrdocs.cjs`**. Install it under the name **`nrdocs`** (the file name does not have to end in `.cjs`):

```bash
sudo cp dist-cli/nrdocs.cjs /usr/local/bin/nrdocs
```

Or, without `sudo`, into your user folder (then use the same “new terminal / `.zshrc`” steps as below if needed):

```bash
mkdir -p "$HOME/.local/bin"
cp dist-cli/nrdocs.cjs "$HOME/.local/bin/nrdocs"
chmod +x "$HOME/.local/bin/nrdocs"
```

If your team publishes binaries under **another GitHub fork**, you can still try **`install.sh`** and point it there: **`NRDOCS_RELEASES_REPO=owner/repo sh install.sh`** or **`sh install.sh --repo owner/repo`**.

---

### If you cannot use `sudo` (work laptop, no admin): default user install

This uses **`sh install.sh`** with no flags. The file is saved under your personal account, usually:

**Full path to the program:** `$HOME/.local/bin/nrdocs`  
(Your home directory is where your own files live — on macOS it is **`/Users/yourname`**, on Linux often **`/home/yourname`**.)

1. Run the installer (needs `curl` or `wget`):

   ```bash
   sh install.sh
   ```

2. When it finishes, run **`nrdocs --help`** in the **same** window.

   - If help appears, you are done for that window. Open a **brand-new** terminal and run **`nrdocs --help`** again. If the **new** window says `command not found`, continue to step 3.
   - If you already see `command not found` in step 2, go to step 3.

3. Tell your terminal to look in that folder **every time it starts**. You do this by adding **one line** to a small text file in your home folder. Which file depends on your computer — pick **one** path only:

   **macOS (Terminal.app or iTerm, default since Catalina)** — the settings file is **`.zshrc`** in your home folder (same folder as Desktop and Documents). Copy this **entire** line, paste it into the terminal, press Enter:

   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc" && . "$HOME/.zshrc"
   ```

   **Linux, or Windows WSL, or Git Bash** — the file is usually **`.bashrc`**. Copy this **entire** line, paste, Enter:

   ```bash
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc" && . "$HOME/.bashrc"
   ```

   What this does: it **appends** one line to that settings file. The line means “also look inside **`$HOME/.local/bin`** when I type a command.” The `>>` does **not** erase anything; it only adds a line at the end.

4. **Quit** the terminal app fully (all windows), open it again, then run:

   ```bash
   nrdocs --help
   ```

5. If it **still** fails, run **`echo $SHELL`**. If the line ends in **`bash`** but you used the macOS block above, try the **Linux / WSL** block instead (and the reverse if it ends in **`zsh`**).

**Already ran `install.sh` without `--system`?** You do **not** have to download again unless you want to. If `command not found`, you only need step 3 onward (the file is already on disk).

---

### Last resort: run by full path (no settings files)

You can always run the program by typing its **full location** (no `PATH` setup). After `sh install.sh`, the installer prints a line like **`nrdocs installed to /something/.local/bin/nrdocs`**. Use that path literally:

```bash
"/Users/yourname/.local/bin/nrdocs" --help
```

Replace the quoted path with the path your installer printed. For `init`, use the same quoted path instead of `nrdocs`.

---

### Build from this repo and copy to `~/.local/bin`

From the **nrdocs** repository root (Node.js 20+):

```bash
npm install
npm run build:cli
mkdir -p "$HOME/.local/bin"
cp dist-cli/nrdocs.cjs "$HOME/.local/bin/nrdocs"
chmod +x "$HOME/.local/bin/nrdocs"
```

Ensure **`$HOME/.local/bin`** is on your **`PATH`** (see the macOS / Linux blocks [above](#if-you-cannot-use-sudo-work-laptop-no-admin-default-user-install)), then **verify which file runs**:

```bash
command -v nrdocs
```

You want a path ending in **`/.local/bin/nrdocs`**. Then run **`nrdocs`** (brief usage) or **`nrdocs --help`** (full help).

#### “bash: /usr/local/bin/nrdocs: No such file or directory” after copying to `~/.local/bin`

That message means the shell is still trying to run **`/usr/local/bin/nrdocs`** (for example you used **`sudo sh install.sh --system`** earlier, then removed that file, or it never existed). **Bash caches command locations** — it does not automatically notice your new copy in **`~/.local/bin`**.

Do **one** of the following, then run **`command -v nrdocs`** again:

1. **Bash:** `hash -r` (clears the cache), or open a **new** terminal.
2. **zsh:** `rehash`, or a new terminal.
3. Remove a broken install: **`sudo rm -f /usr/local/bin/nrdocs`** if you no longer use a system-wide binary.

If **`command -v`** still points at **`/usr/local/bin/nrdocs`**, put **`~/.local/bin` first** on `PATH` (prepend in **`~/.bashrc`** or **`~/.zshrc`**: `export PATH="$HOME/.local/bin:$PATH"`).

---

### Option — manual download from GitHub Releases

Download the asset named `nrdocs-linux-x64`, `nrdocs-linux-arm64`, `nrdocs-darwin-x64`, or `nrdocs-darwin-arm64` from [nrdocs releases](https://github.com/nrdocs/nrdocs/releases), verify the `.sha256` file if provided, run `chmod +x` on the file, rename it to `nrdocs`, then either move it to **`/usr/local/bin`** (with appropriate permissions) or follow the “full path” idea above pointing at wherever you saved the file.

---

## Run `init` on a fresh repo

### 1. Prepare the repository

- Create a new GitHub repository (or use an existing one) for documentation.
- Clone it locally and `cd` into the clone.
- Set **`origin`** to that GitHub repo (`git clone` already does this, or `git remote add origin …`).

The CLI uses `origin` to infer **repo identity** (`github.com/org/repo`) unless you override it.

### 2. Run onboarding

```bash
nrdocs init --token 'eyJhbGciOi…'   # paste the full JWT from your admin
```

The CLI will:

- Validate the token with the control plane and show **organization name** and **remaining quota**.
- Ask for **project slug**, **title**, **docs directory** (default `docs`), **publish branch** (default: current branch, falling back to `main`), and optional **description** (interactive mode), or you pass them as flags for automation — see [CLI Reference](../cli/index.html).
- Register the project and mint a **repo publish token** (scoped to that repo).
- Write **`project.yml`**, **`nav.yml`**, **`content/home.md`**, and **`.github/workflows/publish-docs.yml`** under your tree.
- Generate a workflow that publishes via **GitHub Actions OIDC** (no per-repo secrets/variables).

### 3. Commit and push

```bash
git add -A
git commit -m "Add nrdocs project and publish workflow"
git push origin <publish-branch>
```

The workflow triggers on pushes to the configured publish branch. Your first successful run publishes the scaffolded `home` page; edit **`docs/content`** (or whatever **docs directory** you chose) and push that branch again to update the live site.

### Interrupted init

If `nrdocs init` is interrupted after the remote project was created but before local files or GitHub secrets were finished, rerun the same command with the same bootstrap token from the same repository. The Control Plane treats this as recovery for the same unpublished project: it reuses the existing project and mints a replacement repo publish token without consuming another bootstrap quota slot.

If the project has already been published, or if the existing slug belongs to a different repository identity, init will stop and ask you to resolve it with your platform operator.

---

## For operators: issuing a bootstrap token

Authors cannot mint this for themselves in the default setup. Operators create bootstrap tokens through the Control Plane API using the same `nrdocs` CLI:

**Prerequisites**

- `NRDOCS_API_URL` points to the deployed Control Plane Worker.
- `NRDOCS_API_KEY` is the operator API key, kept in a private operator `.env` or shell environment.
- An active organization exists, usually `default`.

Run this from an operator workspace, not from the documentation repo:

```bash
nrdocs admin init --org default
```

The command prints a signed bootstrap token and the exact command for the repo owner:

```bash
nrdocs init --token '<bootstrap-token>'
```

Useful options:

- `--max-repos <n>`: how many repositories this token may onboard, default `1`.
- `--expires-in-days <n>`: token lifetime, default `7`.
- `--created-by <label>`: audit label for the operator or automation.
- `--json`: raw response for scripts.

Treat the printed token like a password. Send it out-of-band through your team’s normal secure channel.

Emergency fallback only: if the Control Plane API is unavailable, operators can still insert a `bootstrap_tokens` row in D1 and sign a matching `org_bootstrap` JWT with `TOKEN_SIGNING_KEY`, but that is no longer the normal workflow.

---

## After onboarding

| Topic | Where to read more |
|--------|---------------------|
| Editing nav and pages | [Repository Setup](../repository-setup/index.html) |
| Flags for non-interactive / CI | [CLI Reference](../cli/index.html) |
| What publish sends and how URLs work | [Publishing](../publishing/index.html), [How it works](../../how-it-works/index.html) |
| Manual / admin API path (no token) | [Publishing](../publishing/index.html), [Repository Setup](../repository-setup/index.html) |

---

## Roles at a glance

| Role | What they do |
|------|----------------|
| **Platform operator** | Deploys nrdocs ([Installation](../installation/index.html)), runs **`nrdocs admin init`** to issue bootstrap tokens, hands JWT strings to teams. |
| **Documentation author** | Installs `nrdocs`, runs **`nrdocs init --token …`** in the repo, commits, pushes — no Cloudflare dashboard required. |

If anything fails after `init` (for example file write errors after the project was already created remotely), the CLI explains that the remote project may already exist; coordinate with your operator to remove or reuse it.
