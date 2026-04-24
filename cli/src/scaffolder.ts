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
}

/**
 * Generate project.yml content (no access_mode field).
 */
export function generateProjectYml(config: ScaffoldConfig): string {
  let yml = `slug: ${config.slug}\n`;
  yml += `title: "${config.title}"\n`;
  yml += `description: "${config.description}"\n`;
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
 * Uses NRDOCS_PUBLISH_TOKEN (secret), NRDOCS_PROJECT_ID (variable),
 * X-Repo-Identity header, embedded API URL, push-to-main trigger.
 */
export function generatePublishWorkflow(config: ScaffoldConfig): string {
  const defaultDocsDir = config.docsDir || 'docs';
  return `name: Publish Docs to nrdocs

on:
  push:
    branches:
      - main

jobs:
  publish:
    name: Publish documentation
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Build payload and publish
        env:
          NRDOCS_API_URL: ${config.apiUrl}
          NRDOCS_PROJECT_ID: \${{ vars.NRDOCS_PROJECT_ID }}
          NRDOCS_DOCS_DIR: \${{ vars.NRDOCS_DOCS_DIR || '${defaultDocsDir}' }}
        run: |
          set -euo pipefail
          DOCS_DIR="\${NRDOCS_DOCS_DIR:-${defaultDocsDir}}"

          if [ -z "\${NRDOCS_PROJECT_ID:-}" ]; then
            echo "::error::NRDOCS_PROJECT_ID variable is not set"
            exit 1
          fi

          # Read config files
          project_yml=$(jq -Rs '.' < "$DOCS_DIR/project.yml")
          nav_yml=$(jq -Rs '.' < "$DOCS_DIR/nav.yml")

          if [ -f "$DOCS_DIR/allowed-list.yml" ]; then
            allowed_list_yml=$(jq -Rs '.' < "$DOCS_DIR/allowed-list.yml")
          else
            allowed_list_yml="null"
          fi

          # Read all Markdown pages
          pages_json=$(jq -n '{}')
          while IFS= read -r -d '' file; do
            relative="\${file#"$DOCS_DIR/content/"}"
            key="\${relative%.md}"
            page_content=$(jq -Rs '.' < "$file")
            pages_json=$(echo "$pages_json" | jq --arg k "$key" --argjson v "$page_content" '. + {($k): $v}')
          done < <(find "$DOCS_DIR/content" -name '*.md' -type f -print0 | sort -z)

          # Assemble payload
          payload=$(jq -n \\
            --argjson project_yml "$project_yml" \\
            --argjson nav_yml "$nav_yml" \\
            --argjson allowed_list_yml "$allowed_list_yml" \\
            --argjson pages "$pages_json" \\
            '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, allowed_list_yml: $allowed_list_yml, pages: $pages}}')

          # Publish
          http_code=$(curl -s -o response.json -w '%{http_code}' \\
            -X POST \\
            -H "Content-Type: application/json" \\
            -H "Authorization: Bearer \${{ secrets.NRDOCS_PUBLISH_TOKEN }}" \\
            -H "X-Repo-Identity: github.com/\${{ github.repository }}" \\
            -d "$payload" \\
            "\${NRDOCS_API_URL}/projects/\${NRDOCS_PROJECT_ID}/publish")

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
 * Validate existing publish-docs.yml: must contain NRDOCS_PUBLISH_TOKEN,
 * NRDOCS_PROJECT_ID, and X-Repo-Identity references.
 */
export function validateExistingWorkflow(): boolean {
  const filePath = join('.github', 'workflows', 'publish-docs.yml');
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return (
      content.includes('NRDOCS_PUBLISH_TOKEN') &&
      content.includes('NRDOCS_PROJECT_ID') &&
      content.includes('X-Repo-Identity')
    );
  } catch {
    return false;
  }
}
