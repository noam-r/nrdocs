import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatId, parseNrdocsConfig, type SiteId } from '@nrdocs/contracts';
import { buildArtifactFromConfig } from '@nrdocs/renderer';
import { expandArtifactArchive } from './archive.js';
import { validateExpandedArtifact } from './validate-artifact.js';

const SITE = formatId('site', new Uint8Array(16).fill(2)) as SiteId;

describe('validateExpandedArtifact schema v3', () => {
  it('accepts an OpenAPI-enabled schema 3 artifact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nrdocs-v3-'));
    try {
      await fs.writeFile(
        path.join(root, 'openapi.yaml'),
        `openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      responses:
        '200':
          description: ok
`,
      );
      const config = parseNrdocsConfig({
        title: 'API Docs',
        language: 'en',
        direction: 'ltr',
        navigation: 'auto',
        api: { specification: 'openapi.yaml' },
      });
      const built = await buildArtifactFromConfig(root, config, { siteId: SITE });
      expect(built.artifact.manifest.schema_version).toBe(3);
      const expanded = await expandArtifactArchive(built.gzipBytes);
      const validated = await validateExpandedArtifact(expanded, {
        expectedSiteId: SITE,
        expectedDigest: built.digest,
      });
      expect(validated.manifest.schema_version).toBe(3);
      if (validated.manifest.schema_version !== 3) throw new Error('expected v3');
      expect(validated.files.has(validated.manifest.openapi_download.object)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
