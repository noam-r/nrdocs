import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface ScaffoldConfig {
  slug: string;
  title: string;
  description: string;
  docsDir: string;
  apiUrl: string;       // Control Plane base URL (workflow embeds this for OIDC audience)
  repoIdentity: string;
  publishBranch: string;
  accessMode?: 'public' | 'password';
}

/**
 * Generate project.yml content.
 *
 * This file is part of the publish contract: the Control Plane validates
 * `publish_enabled` and `access_mode` during publish.
 */
export function generateProjectYml(config: ScaffoldConfig): string {
  let yml = `slug: ${config.slug}\n`;
  yml += `title: "${config.title}"\n`;
  yml += `description: "${config.description}"\n`;
  yml += `publish_enabled: true\n`;
  yml += `access_mode: ${config.accessMode ?? 'public'}\n`;
  return yml;
}

/**
 * Generate nav.yml content with default Home entry.
 */
export function generateNavYml(): string {
  return `nav:\n  - label: Home\n    path: home\n`;
}

/**
 * Generate starter home.md content.
 */
export function generateHomeMd(title: string): string {
  return `---\ntitle: Home\norder: 1\n---\n\n# ${title}\n\nWelcome to ${title} documentation.\n`;
}

/**
 * Generate publish-docs.yml workflow content.
 * Uses GitHub OIDC (id-token) to fetch short-lived publish credentials
 * from the Control Plane (no per-repo secrets/variables required).
 */
export function generatePublishWorkflow(config: ScaffoldConfig): string {
  const defaultDocsDir = config.docsDir || 'docs';
  return `name: Publish Docs to nrdocs

on:
  push:
    branches:
      - ${config.publishBranch}
  workflow_dispatch:
    inputs:
      mode:
        description: "publish | set-password"
        required: true
        default: "publish"
      password:
        description: "Password to set (mode=set-password). Not stored; avoid pasting into logs."
        required: false
      access_mode:
        description: "Access mode to set (mode=set-access-mode): public | password"
        required: false

jobs:
  publish:
    name: Publish documentation
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Build payload and publish
        env:
          NRDOCS_API_URL: ${config.apiUrl}
          NRDOCS_DOCS_DIR: \${{ vars.NRDOCS_DOCS_DIR || '${defaultDocsDir}' }}
          # Optional: public delivery worker origin (no trailing slash). Use if Control Plane has no DELIVERY_URL.
          NRDOCS_DELIVERY_URL: \${{ vars.NRDOCS_DELIVERY_URL || '' }}
          NRDOCS_MODE: \${{ github.event.inputs.mode || 'publish' }}
          NRDOCS_NEW_PASSWORD: \${{ github.event.inputs.password || '' }}
          NRDOCS_ACCESS_MODE: \${{ github.event.inputs.access_mode || '' }}
        run: |
          set -euo pipefail
          DOCS_DIR="\${NRDOCS_DOCS_DIR:-${defaultDocsDir}}"
          export DOCS_DIR
          API_BASE="\${NRDOCS_API_URL%/}"
          MODE="\${NRDOCS_MODE:-publish}"

          # Request a GitHub Actions OIDC token scoped to the Control Plane URL (audience)
          audience=$(printf '%s' "\${API_BASE}" | jq -sRr @uri)
          oidc_json=$(curl -sSf -H "Authorization: Bearer \${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" "\${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=\${audience}")
          oidc_token=$(echo "$oidc_json" | jq -r '.value')
          if [ -z "$oidc_token" ] || [ "$oidc_token" = "null" ]; then
            echo "::error::Failed to acquire GitHub OIDC token"
            exit 1
          fi

          # Repo-proof challenge verification FIRST (before register/publish).
          # If a challenge file is present in the commit, verify it and exit without publishing.
          if ls ".nrdocs/challenges/"*.json >/dev/null 2>&1; then
            verify_failed=0
            for f in .nrdocs/challenges/*.json; do
              challenge_id=$(basename "$f" .json)
              public_token=$(jq -r '.public_token' "$f")
              repo_identity=$(jq -r '.repo_identity' "$f")
              if [ -z "$public_token" ] || [ "$public_token" = "null" ] || [ -z "$repo_identity" ] || [ "$repo_identity" = "null" ]; then
                echo "::notice::Invalid challenge file format: $f (skipping)"
                verify_failed=1
                continue
              fi
              verify_payload=$(mktemp)
              jq -n \
                --arg repo_identity "$repo_identity" \
                --arg ref "\${GITHUB_REF}" \
                --arg sha "\${GITHUB_SHA}" \
                --arg public_token "$public_token" \
                '{repo_identity: $repo_identity, ref: $ref, sha: $sha, public_token: $public_token}' > "$verify_payload"
              vcode=$(curl -s -o verify_response.json -w '%{http_code}' \\
                -X POST \\
                -H "Content-Type: application/json" \\
                -H "Authorization: Bearer $oidc_token" \\
                --data-binary "@$verify_payload" \\
                "\${API_BASE}/repo-proof/challenges/\${challenge_id}/verify")
              echo "Challenge verify status: \${vcode}"
              cat verify_response.json
              if [ "$vcode" -lt 200 ] || [ "$vcode" -ge 300 ]; then
                reason=$(jq -r '.error // empty' verify_response.json 2>/dev/null || true)
                if [ "$vcode" = "409" ] && [ "$reason" = "Challenge expired" ]; then
                  echo "::notice::Challenge \${challenge_id} expired. Re-run 'nrdocs password set' to issue a fresh challenge."
                else
                  if [ -n "$reason" ]; then
                    echo "::notice::Challenge verification did not complete for \${challenge_id} (HTTP \${vcode}: $reason)."
                  else
                    echo "::notice::Challenge verification did not complete for \${challenge_id} (HTTP \${vcode})."
                  fi
                fi
                verify_failed=1
                continue
              fi
            done
            if [ "$verify_failed" -eq 1 ]; then
              echo "::error::Repo-proof verification failed. Until this returns HTTP 2xx, 'nrdocs password set' cannot apply your password (CLI keeps retrying 'Challenge not verified')."
              exit 1
            fi
            echo "Challenge(s) verified on the Control Plane. Skipping publish."
            exit 0
          fi

          # Register project with Control Plane (GitHub OIDC, no API key). Idempotent.
          reg_payload=$(ruby -ryaml -rjson -e 'require "yaml"; require "json"; d = YAML.load_file(File.join(ENV["DOCS_DIR"], "project.yml")); puts JSON.generate({"slug" => d["slug"], "title" => d["title"], "description" => d.fetch("description", "").to_s, "access_mode" => d["access_mode"], "repo_url" => "https://github.com/" + ENV.fetch("GITHUB_REPOSITORY")})')
          reg_code=$(curl -s -o register_response.json -w '%{http_code}' \\
            -X POST \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer $oidc_token" \\
            --data-binary "$reg_payload" \\
            "\${API_BASE}/oidc/register-project")
          echo "Registration HTTP status: \${reg_code}"
          cat register_response.json || true
          if [ "$reg_code" -lt 200 ] || [ "$reg_code" -ge 300 ]; then
            echo "::error::Project registration failed with HTTP \${reg_code}"
            exit 1
          fi
          if command -v jq >/dev/null 2>&1 && [ -f register_response.json ]; then
            reg_id=$(jq -r '.id // empty' register_response.json)
            if [ -n "$reg_id" ] && [ "$reg_id" != "null" ]; then
              if [ -n "\${GITHUB_OUTPUT:-}" ]; then
                echo "nrdocs_project_id=$reg_id" >> "\$GITHUB_OUTPUT"
              fi
              if [ -n "\${GITHUB_STEP_SUMMARY:-}" ]; then
                {
                  echo "## nrdocs registration"
                  echo "Internal project id (optional for local tooling): \`$reg_id\`"
                } >> "\$GITHUB_STEP_SUMMARY"
              fi
            fi
          fi

          # Exchange OIDC for short-lived publish credentials (poll until approved in the same job)
          POLL_SECS="\${NRDOCS_APPROVAL_POLL_INTERVAL:-30}"
          MAX_WAIT="\${NRDOCS_APPROVAL_MAX_WAIT_SECS:-3600}"
          elapsed=0
          exchange_code=""
          while true; do
            exchange_code=$(curl -s -o exchange.json -w '%{http_code}' -X POST -H "Authorization: Bearer $oidc_token" "\${API_BASE}/oidc/publish-credentials")
            if [ "$exchange_code" -ge 200 ] && [ "$exchange_code" -lt 300 ]; then
              break
            fi
            if [ "$exchange_code" = "409" ]; then
              err=$(jq -r '.error // empty' exchange.json 2>/dev/null || true)
              case "$err" in
                *"not approved"*)
                  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
                    echo "::warning::Stopped waiting for approval after \${MAX_WAIT}s. Re-run the workflow or push after the operator approves."
                    exit 0
                  fi
                  echo "::notice::Waiting for operator approval (\${elapsed}s / \${MAX_WAIT}s max, every \${POLL_SECS}s)..."
                  sleep "$POLL_SECS"
                  elapsed=$((elapsed + POLL_SECS))
                  continue
                  ;;
              esac
            fi
            echo "::error::OIDC exchange failed with HTTP $exchange_code"
            cat exchange.json || true
            exit 1
          done
          creds=$(cat exchange.json)
          NRDOCS_REPO_ID=$(echo "$creds" | jq -r '.repo_id')
          NRDOCS_PUBLISH_TOKEN=$(echo "$creds" | jq -r '.repo_publish_token')
          if [ -z "$NRDOCS_REPO_ID" ] || [ "$NRDOCS_REPO_ID" = "null" ]; then
            echo "::error::OIDC exchange did not return repo_id"
            echo "$creds"
            exit 1
          fi
          if [ -z "$NRDOCS_PUBLISH_TOKEN" ] || [ "$NRDOCS_PUBLISH_TOKEN" = "null" ]; then
            echo "::error::OIDC exchange did not return repo_publish_token"
            echo "$creds"
            exit 1
          fi

          # Password rotation mode (repo owner initiated, no stored secrets)
          if [ "$MODE" = "set-password" ]; then
            if [ -z "\${NRDOCS_NEW_PASSWORD:-}" ]; then
              echo "::error::Missing workflow input: password"
              exit 1
            fi
            echo "::add-mask::\${NRDOCS_NEW_PASSWORD}"
            pw_payload=$(mktemp)
            jq -n --arg password "\${NRDOCS_NEW_PASSWORD}" '{password: $password}' > "$pw_payload"
            pw_code=$(curl -s -o pw_response.json -w '%{http_code}' \\
              -X POST \\
              -H "Content-Type: application/json" \\
              -H "Authorization: Bearer \${NRDOCS_PUBLISH_TOKEN}" \\
              --data-binary "@$pw_payload" \\
              "\${API_BASE}/repos/\${NRDOCS_REPO_ID}/password")
            echo "Response status: \${pw_code}"
            cat pw_response.json
            if [ "$pw_code" -lt 200 ] || [ "$pw_code" -ge 300 ]; then
              echo "::error::Set password failed with HTTP \${pw_code}"
              exit 1
            fi
            echo "Password updated."
            exit 0
          fi

          # Access-mode change (repo owner initiated, no stored secrets)
          if [ "$MODE" = "set-access-mode" ]; then
            if [ -z "\${NRDOCS_ACCESS_MODE:-}" ]; then
              echo "::error::Missing workflow input: access_mode"
              exit 1
            fi
            if [ "\${NRDOCS_ACCESS_MODE}" != "public" ] && [ "\${NRDOCS_ACCESS_MODE}" != "password" ]; then
              echo "::error::Invalid access_mode (expected public|password)"
              exit 1
            fi
            am_payload=$(mktemp)
            jq -n --arg access_mode "\${NRDOCS_ACCESS_MODE}" '{access_mode: $access_mode}' > "$am_payload"
            am_code=$(curl -s -o am_response.json -w '%{http_code}' \\
              -X POST \\
              -H "Content-Type: application/json" \\
              -H "Authorization: Bearer \${NRDOCS_PUBLISH_TOKEN}" \\
              --data-binary "@$am_payload" \\
              "\${API_BASE}/repos/\${NRDOCS_REPO_ID}/access-mode")
            echo "Response status: \${am_code}"
            cat am_response.json
            if [ "$am_code" -lt 200 ] || [ "$am_code" -ge 300 ]; then
              echo "::error::Set access mode failed with HTTP \${am_code}"
              exit 1
            fi
            echo "Access mode updated."
            exit 0
          fi

          # Build pages map without passing large strings as CLI args.
          pages_file=$(mktemp)
          echo '{}' > "$pages_file"
          while IFS= read -r -d '' file; do
            relative="\${file#"$DOCS_DIR/content/"}"
            key="\${relative%.md}"
            tmp_pages=$(mktemp)
            jq --arg k "$key" --rawfile v "$file" '. + {($k): $v}' "$pages_file" > "$tmp_pages"
            mv "$tmp_pages" "$pages_file"
          done < <(find "$DOCS_DIR/content" -name '*.md' -type f -print0 | sort -z)

          # Assemble payload (rawfile reads file content directly; no huge argv).
          payload_file=$(mktemp)
          if [ -f "$DOCS_DIR/allowed-list.yml" ]; then
            jq -n \
              --rawfile project_yml "$DOCS_DIR/project.yml" \
              --rawfile nav_yml "$DOCS_DIR/nav.yml" \
              --rawfile allowed_list_yml "$DOCS_DIR/allowed-list.yml" \
              --slurpfile pages "$pages_file" \
              '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, allowed_list_yml: $allowed_list_yml, pages: $pages[0]}}' > "$payload_file"
          else
            jq -n \
              --rawfile project_yml "$DOCS_DIR/project.yml" \
              --rawfile nav_yml "$DOCS_DIR/nav.yml" \
              --slurpfile pages "$pages_file" \
              '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, allowed_list_yml: null, pages: $pages[0]}}' > "$payload_file"
          fi

          # Publish
          http_code=$(curl -s -o response.json -w '%{http_code}' \\
            -X POST \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer \${NRDOCS_PUBLISH_TOKEN}" \\
            -H "X-Repo-Identity: github.com/\${{ github.repository }}" \\
            --data-binary "@$payload_file" \\
            "\${API_BASE}/repos/\${NRDOCS_REPO_ID}/publish")

          echo "Response status: \${http_code}"
          cat response.json

          if [ "\$http_code" -lt 200 ] || [ "\$http_code" -ge 300 ]; then
            echo "::error::Publish failed with HTTP \${http_code}"
            exit 1
          fi
          echo "Publish succeeded."
          pub_url=$(jq -r 'if (.url == null or .url == "") then empty else .url end' response.json 2>/dev/null || true)
          pub_slug=$(jq -r 'if (.slug == null or .slug == "") then empty else .slug end' response.json 2>/dev/null || true)
          if [ -z "\$pub_url" ] && [ -n "\${NRDOCS_DELIVERY_URL:-}" ] && [ -n "\$pub_slug" ]; then
            base="\${NRDOCS_DELIVERY_URL%/}"
            pub_url="\${base}/\${pub_slug}/"
          fi
          if [ -n "\$pub_url" ]; then
            echo "Reader URL: \$pub_url"
            if [ -n "\${GITHUB_STEP_SUMMARY:-}" ]; then
              {
                echo "## Published documentation"
                echo "Reader URL: \`\$pub_url\`"
              } >> "\$GITHUB_STEP_SUMMARY"
            fi
          elif [ -n "\$pub_slug" ]; then
            echo "::warning::Published, but no reader URL yet. Set DELIVERY_URL on the Control Plane Worker and redeploy, **or** add GitHub variable NRDOCS_DELIVERY_URL (delivery base URL, no trailing slash). Slug: \$pub_slug"
            if [ -n "\${GITHUB_STEP_SUMMARY:-}" ]; then
              {
                echo "## Published documentation"
                echo "Site slug: \`\$pub_slug\`"
                echo ""
                echo "Configure the public delivery base URL so the exact link appears:"
                echo "- **Control Plane** Worker env: \`DELIVERY_URL\` (e.g. \`https://docs.example.com\`)"
                echo "- **Or** repo variable: **Settings → Actions → Variables** → \`NRDOCS_DELIVERY_URL\`"
                echo ""
                echo "Reader path pattern: \`https://<your-delivery-host>/\${pub_slug}/\`"
              } >> "\$GITHUB_STEP_SUMMARY"
            fi
          fi
`;
}

/**
 * Check if a critical file exists and compare content.
 * Returns 'missing' if file doesn't exist, 'identical' if content matches,
 * or 'differs' if content is different.
 */
export function checkExistingFile(
  path: string,
  generatedContent: string,
): 'missing' | 'identical' | 'differs' {
  if (!existsSync(path)) {
    return 'missing';
  }
  const existing = readFileSync(path, 'utf-8');
  return existing === generatedContent ? 'identical' : 'differs';
}

/**
 * Validate existing project.yml: must parse as YAML with slug and title fields.
 */
export function validateExistingProjectYml(docsDir: string): boolean {
  const filePath = join(docsDir, 'project.yml');
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parse(content);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const obj = parsed as Record<string, unknown>;
    return (
      typeof obj.slug === 'string' &&
      obj.slug.length > 0 &&
      typeof obj.title === 'string' &&
      obj.title.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Validate existing nav.yml: must parse as valid YAML.
 */
export function validateExistingNavYml(docsDir: string): boolean {
  const filePath = join(docsDir, 'nav.yml');
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    parse(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate existing publish-docs.yml: must contain OIDC exchange endpoint and
 * repo identity header binding.
 */
export function validateExistingWorkflow(): boolean {
  const filePath = join('.github', 'workflows', 'publish-docs.yml');
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return (
      content.includes('/oidc/publish-credentials') &&
      content.includes('ACTIONS_ID_TOKEN_REQUEST_URL') &&
      content.includes('X-Repo-Identity')
    );
  } catch {
    return false;
  }
}
