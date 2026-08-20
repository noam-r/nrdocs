import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenApiError } from './errors.js';
import { buildOpenApiIntegration } from './integrate.js';

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nrdocs-openapi-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

async function writeSpec(root: string, name: string, contents: string): Promise<void> {
  await fsp.writeFile(path.join(root, name), contents, 'utf8');
}

describe('OpenAPI reference module', () => {
  it('accepts a valid 3.1 minimal document with one operation and schema', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [pets]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      required: [id]
      properties:
        id:
          type: integer
        name:
          type: string
`,
    );

    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    expect(result.pages.length).toBe(3); // landing + op + schema
    expect(result.pages.map((p) => p.route)).toEqual([
      '/api-reference/',
      '/api-reference/operations/listPets/',
      '/api-reference/schemas/Pet/',
    ]);
    expect(result.pages.every((p) => p.origin === 'openapi')).toBe(true);
    expect(
      result.pages.every((p) => typeof p.articleHtml === 'string' && p.articleHtml.length > 0),
    ).toBe(true);
    expect(result.navSection.title).toBe('API Reference');
    expect(result.navSection.route).toBe('/api-reference/');
    expect(result.sourcePaths.has('openapi.yaml')).toBe(true);
    expect(result.openapiDownload.route).toBe('/api-reference/openapi.json');
    expect(result.openapiDownload.mediaType).toBe('application/vnd.nrdocs.openapi+json');

    const landing = result.pages[0]!;
    expect(landing.articleHtml).toContain('Download OpenAPI');
    expect(landing.articleHtml).toContain('openapi.json');
    expect(landing.articleHtml).toContain('nr-api-');

    const op = result.pages[1]!;
    expect(op.articleHtml).toContain('nr-tabs');
    expect(op.articleHtml).toContain('nr-tab-panel');
    expect(op.articleHtml).toContain('>cURL</button>');
    expect(op.articleHtml).toContain('>JavaScript</button>');
    expect(op.articleHtml).toContain('>HTTP</button>');
    expect(op.articleHtml).toContain('hljs-title">fetch</span>');
    expect(op.articleHtml).toContain('GET');
    expect(op.articleHtml).toContain('/pets');
    expect(op.markdownText).toContain('listPets');
    expect(op.markdownText).toContain('### JavaScript');
    expect(op.markdownText).toContain('await fetch(');
    expect(op.markdownText).toContain('Not specified');

    const bundled = new TextDecoder().decode(result.bundledJson);
    expect(bundled).toContain('"openapi": "3.1.0"');
    expect(bundled).toContain('listPets');
  });

  it('fails when operationId is missing', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List
      responses:
        '200':
          description: ok
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_operation_id',
    });
  });

  it('fails on remote $ref', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: https://example.com/schemas.json#/Pet
`,
    );
    try {
      await buildOpenApiIntegration(root, 'openapi.yaml');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OpenApiError);
      expect((err as OpenApiError).code).toBe('openapi_remote_ref');
    }
  });

  it('fails on OpenAPI 2.0', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
swagger: '2.0'
info:
  title: Demo
  version: 1.0.0
paths: {}
`,
    );
    // swagger 2.0 without openapi field
    await writeSpec(
      root,
      'openapi2.yaml',
      `
openapi: '2.0'
info:
  title: Demo
  version: 1.0.0
paths: {}
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi2.yaml')).rejects.toMatchObject({
      code: 'openapi_unsupported_version',
    });
  });

  it('distinguishes cost free vs absent vs fixed', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
x-nrdocs-costs:
  unit: credits
paths:
  /a:
    get:
      operationId: freeOp
      x-nrdocs-cost:
        type: free
      responses:
        '200':
          description: ok
  /b:
    get:
      operationId: absentOp
      responses:
        '200':
          description: ok
  /c:
    get:
      operationId: fixedOp
      x-nrdocs-cost:
        type: fixed
        amount: 5
      responses:
        '200':
          description: ok
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const byId = Object.fromEntries(
      result.pages
        .filter((p) => p.route.includes('/operations/'))
        .map((p) => [p.route.split('/').at(-2)!, p]),
    );
    expect(byId.freeOp!.articleHtml).toContain('Free');
    expect(byId.freeOp!.markdownText).toContain('Free');
    expect(byId.absentOp!.articleHtml).toContain('Not specified');
    expect(byId.absentOp!.markdownText).toContain('Not specified');
    expect(byId.fixedOp!.articleHtml).toContain('5 credits per request');
    expect(byId.fixedOp!.markdownText).toContain('5 credits per request');
  });

  it('requires x-codeSamples lang', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      x-codeSamples:
        - language: python
          source: print(1)
      responses:
        '200':
          description: ok
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_extension_invalid',
    });
  });

  it('uses language tabs only and lets x-codeSamples override by lang', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      x-codeSamples:
        - lang: bash
          label: List with limit
          source: |
            curl 'https://api.example.com/pets?limit=20'
        - lang: python
          label: Async client
          source: |
            print("pets")
      responses:
        '200':
          description: ok
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const op = result.pages.find((p) => p.route.includes('listPets'))!;
    expect(op.articleHtml).toContain('>cURL</button>');
    expect(op.articleHtml).toContain('>JavaScript</button>');
    expect(op.articleHtml).toContain('>HTTP</button>');
    expect(op.articleHtml).toContain('>python</button>');
    expect(op.articleHtml).toContain('pets?limit=20');
    expect(op.articleHtml).not.toContain('List with limit');
    expect(op.articleHtml).not.toContain('Async client');
    expect(op.markdownText).toContain('### python');
    expect(op.markdownText).toContain('pets?limit=20');
    expect(op.markdownText).not.toContain('List with limit');
  });

  it('hoists multi-file schema $ref into components and creates a schema page', async () => {
    const root = await tempDir();
    await fsp.mkdir(path.join(root, 'schemas'), { recursive: true });
    await writeSpec(
      root,
      'schemas/pet.yaml',
      `
components:
  schemas:
    Pet:
      type: object
      required: [id]
      properties:
        id:
          type: integer
        name:
          type: string
`,
    );
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/pet.yaml#/components/schemas/Pet'
`,
    );

    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    expect(result.pages.map((p) => p.route)).toContain('/api-reference/schemas/Pet/');
    expect(result.sourcePaths.has('schemas/pet.yaml')).toBe(true);

    const bundled = new TextDecoder().decode(result.bundledJson);
    expect(bundled).toContain('#/components/schemas/Pet');
    expect(bundled).toMatch(/"components"\s*:\s*\{[\s\S]*"schemas"\s*:\s*\{[\s\S]*"Pet"/);
    // Must not deep-inline Pet properties at the operation schema site only.
    const opSchemaSite = bundled.indexOf('listPets');
    expect(opSchemaSite).toBeGreaterThan(-1);
  });

  it('resolves path item $ref so operations appear', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    $ref: '#/components/pathItems/Pets'
components:
  pathItems:
    Pets:
      get:
        operationId: listPets
        summary: List pets
        responses:
          '200':
            description: ok
`,
    );

    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    expect(result.pages.map((p) => p.route)).toContain('/api-reference/operations/listPets/');
    const op = result.pages.find((p) => p.route.includes('/operations/listPets/'))!;
    expect(op.articleHtml).toContain('GET');
    expect(op.articleHtml).toContain('/pets');
  });

  it('validates requestBody $ref targets including encoding rejection', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /pets:
    post:
      operationId: createPet
      requestBody:
        $ref: '#/components/requestBodies/PetBody'
      responses:
        '201':
          description: created
components:
  requestBodies:
    PetBody:
      required: true
      content:
        multipart/form-data:
          schema:
            type: object
            properties:
              name:
                type: string
          encoding:
            name:
              contentType: text/plain
`,
    );

    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_unsupported_construct',
    });
  });

  it('round-trips decimal cost amount 0.02 in HTML and bundle', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
x-nrdocs-costs:
  unit: credits
paths:
  /charge:
    post:
      operationId: charge
      x-nrdocs-cost:
        type: fixed
        amount: 0.02
      responses:
        '200':
          description: ok
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const op = result.pages.find((p) => p.route.includes('/operations/charge/'))!;
    expect(op.articleHtml).toContain('0.02 credits per request');
    expect(op.articleHtml).not.toMatch(/0\.02e|e-2|E-2/i);
    expect(op.markdownText).toContain('0.02 credits per request');
    expect(op.articleHtml).toContain('class="nr-copy"');
    expect(op.articleHtml).toContain('aria-label="Copy"');

    const bundled = new TextDecoder().decode(result.bundledJson);
    expect(bundled).toMatch(/"amount":\s*0\.02\b/);
    expect(bundled).not.toMatch(/"amount":\s*"0\.02"/);
    expect(bundled).not.toMatch(/0\.02[eE]/);
  });

  it('resolves Markdown links in OpenAPI descriptions to known routes', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
  description: See [list](/api-reference/operations/listPets/).
paths:
  /pets:
    get:
      operationId: listPets
      description: Also [self](/api-reference/operations/listPets/).
      responses:
        '200':
          description: ok
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const landing = result.pages.find((p) => p.route === '/api-reference/')!;
    expect(landing.articleHtml).toContain('href="operations/listPets/"');
    const op = result.pages.find((p) => p.route.includes('/operations/listPets/'))!;
    expect(op.articleHtml).toMatch(/href="\.\/"/);
  });

  it('rejects images in OpenAPI descriptions', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      description: |
        Hello ![diagram](./pic.png)
      responses:
        '200':
          description: ok
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_link_invalid',
    });
  });

  it('enforces examples per operation limit including baselines', async () => {
    const root = await tempDir();
    const examples: string[] = [];
    for (let i = 0; i < 31; i++) {
      examples.push(`          ex${i}:\n            value: ${i}`);
    }
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    post:
      operationId: createPet
      requestBody:
        content:
          application/json:
            schema:
              type: object
            examples:
${examples.join('\n')}
      responses:
        '200':
          description: ok
`,
    );
    // 31 declared + 3 baselines = 34 > 32
    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_limit_exceeded',
    });
  });

  it('renders enum const default and discriminator on schema pages', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      discriminator:
        propertyName: kind
      default:
        kind: dog
      example:
        kind: dog
      readOnly: true
      minProperties: 1
      maxProperties: 3
      required: [kind]
      properties:
        kind:
          type: string
          enum: [dog, cat]
          const: dog
          writeOnly: true
        tags:
          type: array
          uniqueItems: true
          items:
            type: string
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const schema = result.pages.find((p) => p.route.includes('/schemas/Pet/'))!;
    expect(schema.articleHtml).toContain('Discriminator:');
    expect(schema.articleHtml).toContain('Default:');
    expect(schema.articleHtml).toContain('Example:');
    expect(schema.articleHtml).toContain('readOnly');
    expect(schema.articleHtml).toContain('Enum:');
    expect(schema.articleHtml).toContain('Const:');
    expect(schema.articleHtml).toContain('writeOnly');
    expect(schema.articleHtml).toContain('uniqueItems: true');
    expect(schema.articleHtml).toContain('minProperties: 1');
    expect(schema.articleHtml).toContain('maxProperties: 3');
    expect(schema.markdownText).toContain('Discriminator:');
    expect(schema.markdownText).toContain('Enum:');
    expect(schema.markdownText).toContain('uniqueItems: true');
  });

  it('creates schema pages reachable only via parameter component $refs', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      parameters:
        - $ref: '#/components/parameters/PetId'
      responses:
        '200':
          description: ok
components:
  parameters:
    PetId:
      name: petId
      in: path
      required: true
      schema:
        $ref: '#/components/schemas/PetId'
  schemas:
    PetId:
      type: string
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    expect(result.pages.some((p) => p.route === '/api-reference/schemas/PetId/')).toBe(true);
    const op = result.pages.find((p) => p.route.includes('/operations/getPet/'))!;
    expect(op.articleHtml).toContain('schemas/PetId');
  });

  it('allows OpenAPI description links to known Markdown page routes', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
  description: See the [intro](/guides/intro/).
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml', {
      knownPageRoutes: ['/guides/intro/'],
    });
    const landing = result.pages.find((p) => p.route === '/api-reference/')!;
    expect(landing.articleHtml).toContain('guides/intro');
  });

  it('renders operation externalDocs and response headers', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      externalDocs:
        url: https://example.com/docs
        description: More docs
      responses:
        '200':
          description: ok
          headers:
            X-Request-Id:
              description: Correlation id
              schema:
                type: string
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const op = result.pages.find((p) => p.route.includes('/operations/listPets/'))!;
    expect(op.articleHtml).toContain('https://example.com/docs');
    expect(op.articleHtml).toContain('More docs');
    expect(op.articleHtml).toContain('X-Request-Id');
    expect(op.articleHtml).toContain('Headers');
    expect(op.markdownText).toContain('External docs:');
    expect(op.markdownText).toContain('X-Request-Id');
  });

  it('rejects response links and header content', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          links:
            next:
              operationId: listPets
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi.yaml')).rejects.toMatchObject({
      code: 'openapi_unsupported_construct',
    });

    await writeSpec(
      root,
      'openapi-header.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          headers:
            X-Meta:
              content:
                application/json:
                  schema:
                    type: object
`,
    );
    await expect(buildOpenApiIntegration(root, 'openapi-header.yaml')).rejects.toMatchObject({
      code: 'openapi_unsupported_construct',
    });
  });

  it('renders discriminator mapping when present', async () => {
    const root = await tempDir();
    await writeSpec(
      root,
      'openapi.yaml',
      `
openapi: 3.1.0
info:
  title: Demo
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      discriminator:
        propertyName: kind
        mapping:
          dog: '#/components/schemas/Dog'
          cat: Dog
    Dog:
      type: object
      properties:
        kind:
          type: string
`,
    );
    const result = await buildOpenApiIntegration(root, 'openapi.yaml');
    const schema = result.pages.find((p) => p.route.includes('/schemas/Pet/'))!;
    expect(schema.articleHtml).toContain('nr-api-discriminator-mapping');
    expect(schema.articleHtml).toContain('dog');
    expect(schema.markdownText).toContain('dog');
    expect(schema.markdownText).toContain('#/components/schemas/Dog');
  });
});
