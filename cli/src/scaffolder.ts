import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface ScaffoldConfig {
  slug: string;
  title: string;
  description: string;
  docsDir: string;
  apiUrl: string;       // from bootstrap token iss claim
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
          NRDOCS_MODE: \${{ github.event.inputs.mode || 'publish' }}
          NRDOCS_NEW_PASSWORD: \${{ github.event.inputs.password || '' }}
          NRDOCS_ACCESS_MODE: \${{ github.event.inputs.access_mode || '' }}
        run: |
          set -euo pipefail
          DOCS_DIR="\${NRDOCS_DOCS_DIR:-${defaultDocsDir}}"
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

          # Repo-proof challenge verification (password management without gh)
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
              echo "::notice::Challenge verification run finished with non-fatal issues. Skipping publish for this run."
            else
              echo "Challenge(s) verified. Skipping publish."
            fi
            exit 0
          fi

          # Exchange OIDC for short-lived publish credentials (project_id + repo_publish_token)
          exchange_code=$(curl -s -o exchange.json -w '%{http_code}' -X POST -H "Authorization: Bearer $oidc_token" "\${API_BASE}/oidc/publish-credentials")
          if [ "$exchange_code" -lt 200 ] || [ "$exchange_code" -ge 300 ]; then
            echo "::error::OIDC exchange failed with HTTP $exchange_code"
            cat exchange.json || true
            exit 1
          fi
          creds=$(cat exchange.json)
          NRDOCS_PROJECT_ID=$(echo "$creds" | jq -r '.project_id')
          NRDOCS_PUBLISH_TOKEN=$(echo "$creds" | jq -r '.repo_publish_token')
          if [ -z "$NRDOCS_PROJECT_ID" ] || [ "$NRDOCS_PROJECT_ID" = "null" ]; then
            echo "::error::OIDC exchange did not return project_id"
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
              "\${API_BASE}/projects/\${NRDOCS_PROJECT_ID}/password")
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
              "\${API_BASE}/projects/\${NRDOCS_PROJECT_ID}/access-mode")
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
            "\${API_BASE}/projects/\${NRDOCS_PROJECT_ID}/publish")

          echo "Response status: \${http_code}"
          cat response.json

          if [ "\$http_code" -lt 200 ] || [ "\$http_code" -ge 300 ]; then
            echo "::error::Publish failed with HTTP \${http_code}"
            exit 1
          fi
          echo "Publish succeeded."
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
