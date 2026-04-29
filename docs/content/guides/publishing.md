# Publishing

This guide covers how to register a project, approve it, and publish documentation content.

## Before you start

All Control Plane API requests require an API key in the `Authorization: Bearer <key>` header. This is not a Cloudflare-provided key — it's a secret you generated yourself during installation (see the [Installation guide](../installation/index.html), "Set secrets" section). It's the value you passed to `wrangler secret put API_KEY`.

If you haven't set it yet:

```bash
# Generate a random key
openssl rand -hex 32

# Set it on the Control Plane Worker
wrangler secret put API_KEY --env control-plane
# paste the generated value when prompted
```

Save this key somewhere safe — you'll need it for every admin API call.

## Register a project

```bash
export API_URL="https://nrdocs-control-plane.YOUR_SUBDOMAIN.workers.dev"
export API_KEY="the-key-you-generated-above"

curl -X POST "$API_URL/projects" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "my-project",
    "repo_url": "https://github.com/org/my-project",
    "title": "My Project Docs",
    "description": "Internal documentation",
    "access_mode": "public"
  }'
```

The response includes the project `id` (a UUID). Save it — you need it for all subsequent API calls.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "slug": "my-project",
  "status": "awaiting_approval",
  "access_mode": "public",
  ...
}
```

### What each field means

| Field | Required | Description |
|---|---|---|
| `slug` | yes | URL path segment (within the org). Immutable. Must be **unique per organization** (not globally). Reader URLs: `/<project>/…` for the default org, `/<org-slug>/<project>/…` for named orgs. |
| `repo_url` | yes | Canonical repository URL. Informational — not used for fetching. |
| `title` | yes | Display title shown in the sidebar header. |
| `description` | no | Project description. |
| `access_mode` | yes | `public` or `password`. Immutable after registration. |

## Approve the project

New projects start in `awaiting_approval` status. They won't serve content or accept publishes until approved.

```bash
curl -X POST "$API_URL/projects/$PROJECT_ID/approve" \
  -H "Authorization: Bearer $API_KEY"
```

## Publish content

The publish endpoint expects the repository content as a JSON payload. The Control Plane is the sole build authority — it parses the configs, renders Markdown to HTML, and uploads the artifacts to R2.

### Manual publish (for testing)

Build the payload from a local docs directory and POST it:

```bash
PROJECT_YML=$(cat project.yml)
NAV_YML=$(cat nav.yml)

PAGES=$(jq -n '{}')
for file in $(find content -name '*.md' -type f | sort); do
  relative="${file#content/}"
  key="${relative%.md}"
  content=$(jq -Rs '.' < "$file")
  PAGES=$(echo "$PAGES" | jq --arg k "$key" --argjson v "$content" '. + {($k): $v}')
done

jq -n \
  --arg project_yml "$PROJECT_YML" \
  --arg nav_yml "$NAV_YML" \
  --argjson pages "$PAGES" \
  '{repo_content: {project_yml: $project_yml, nav_yml: $nav_yml, pages: $pages}}' \
| curl -X POST "$API_URL/projects/$PROJECT_ID/publish" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @-
```

### Automated publish (GitHub Actions)

There are two ways to set up automated publishing, depending on how the project was onboarded:

**If onboarded via `nrdocs init --token` (bootstrap token):**

The CLI already generated `.github/workflows/publish-docs.yml`. The workflow uses **GitHub Actions OIDC** (secretless) to authenticate:

- Requests an OIDC token from GitHub with audience set to your Control Plane URL
- Exchanges it at `POST /oidc/publish-credentials` for a short-lived repo publish token + project id
- Calls the standard publish endpoint using those short-lived credentials

No per-repo `NRDOCS_PUBLISH_TOKEN` secret or `NRDOCS_PROJECT_ID` variable is required.

Just push to `main` and it publishes automatically.

**If onboarded via admin API:**

Copy `templates/publish-docs.yml` from the nrdocs repository into your project repository at `.github/workflows/publish-docs.yml` and set these repository secrets:

| Secret | Value |
|---|---|
| `NRDOCS_API_URL` | Your Control Plane Worker URL |
| `NRDOCS_API_KEY` | The API key you configured |

Every push to `main` will automatically publish.

#### Troubleshooting OIDC publish

If publishing fails during the OIDC exchange step:

- Ensure the Control Plane is deployed with `POST /oidc/publish-credentials`
- Ensure the project is approved (`nrdocs admin approve <project-id>`)
- Ensure the project was onboarded with the correct repo identity (`github.com/<owner>/<repo>`)

## What happens during a publish

1. The Control Plane validates the project is `approved`
2. It parses `project.yml`, `nav.yml`, and optionally `allowed-list.yml`
3. It validates the slug in `project.yml` matches the registered slug
4. It renders all Markdown pages to HTML with navigation and TOC
5. It uploads the artifacts to R2 under a versioned prefix (`publishes/<org-slug>/<project-slug>/<publish-id>/`)
6. It atomically updates the active publish pointer in D1
7. It cleans up the previous publish artifacts from R2

If any step fails, the previous version remains live. Partial uploads are cleaned up automatically.

## Where the docs are published

After a successful `nrdocs init`, the CLI prints the final reader URL. After the publish workflow succeeds, visit that URL.

The URL shape is:

```text
https://<delivery-host>/<project-slug>/
```

for the default organization, or:

```text
https://<delivery-host>/<org-slug>/<project-slug>/
```

for named organizations.

If `nrdocs init` prints `<delivery URL unavailable>`, the Control Plane is missing `DELIVERY_URL`. The project can still publish, but users need the Delivery Worker hostname from the platform operator.

## Disable or delete a project

```bash
# Disable — returns 404 to users, preserves all data
curl -X POST "$API_URL/projects/$PROJECT_ID/disable" \
  -H "Authorization: Bearer $API_KEY"

# Delete — removes D1 records, R2 artifacts, everything
curl -X DELETE "$API_URL/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $API_KEY"
```

Deletion proceeds in order: mark disabled (immediate 404), delete R2 artifacts, remove access config, delete D1 records. If R2 cleanup fails, the project is still inaccessible and the failure is logged for manual cleanup.

For **which GitHub repos may publish**, revoking CI tokens, bootstrap quota, and D1 maintenance, see the [Administrator guide](administrator/index.html).
