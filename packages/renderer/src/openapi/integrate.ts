import type { PublicationNavNode, PublicationPage } from '../types.js';
import { bundleOpenApiJson } from './bundle.js';
import { loadOpenApi } from './load.js';
import { normalizeOpenApi } from './normalize.js';
import {
  renderLandingHtml,
  renderOperationHtml,
  renderSchemaHtml,
  type OpenApiHtmlRenderOptions,
} from './render-html.js';
import {
  renderLandingMarkdown,
  renderOperationMarkdown,
  renderSchemaMarkdown,
} from './render-markdown.js';
import { validateOpenApi } from './validate.js';
import type { NormalizedOpenApi } from './types.js';

export type OpenApiIntegrationOptions = {
  /** Published Markdown page routes that OpenAPI rich text may link to. */
  knownPageRoutes?: Iterable<string>;
  /** Attachment public paths that OpenAPI rich text may link to. */
  knownAttachments?: Iterable<string>;
};

export type OpenApiIntegration = {
  model: NormalizedOpenApi;
  navSection: PublicationNavNode;
  pages: PublicationPage[];
  sourcePaths: Set<string>;
  bundledJson: Uint8Array;
  openapiDownload: {
    route: '/api-reference/openapi.json';
    object: 'openapi/openapi.json';
    mediaType: 'application/vnd.nrdocs.openapi+json';
    filename: 'openapi.json';
  };
};

function collectKnownRoutes(
  model: NormalizedOpenApi,
  extraPageRoutes?: Iterable<string>,
): Set<string> {
  const routes = new Set<string>(['/api-reference/', '/api-reference/openapi.json']);
  for (const op of model.operations) {
    routes.add(`/api-reference/operations/${op.operationId}/`);
  }
  for (const schema of model.schemas) {
    routes.add(`/api-reference/schemas/${schema.schemaId}/`);
  }
  if (extraPageRoutes) {
    for (const route of extraPageRoutes) routes.add(route);
  }
  return routes;
}

function htmlOptions(
  model: NormalizedOpenApi,
  options?: OpenApiIntegrationOptions,
): OpenApiHtmlRenderOptions {
  return {
    knownRoutes: collectKnownRoutes(model, options?.knownPageRoutes),
    ...(options?.knownAttachments ? { knownAttachments: new Set(options.knownAttachments) } : {}),
  };
}

function renderOpenApiPages(
  model: NormalizedOpenApi,
  htmlOpts: OpenApiHtmlRenderOptions,
): PublicationPage[] {
  const pages: PublicationPage[] = [];

  const landingRoute = '/api-reference/';
  pages.push({
    sourceFile: '__nrdocs_api__/index.md',
    route: landingRoute,
    title: 'API Reference',
    markdownText: renderLandingMarkdown(model),
    origin: 'openapi',
    articleHtml: renderLandingHtml(model, landingRoute, htmlOpts),
  });

  for (const group of model.tagGroups) {
    for (const op of group.operations) {
      const route = `/api-reference/operations/${op.operationId}/`;
      pages.push({
        sourceFile: `__nrdocs_api__/operations/${op.operationId}.md`,
        route,
        title: op.summary ?? op.operationId,
        markdownText: renderOperationMarkdown(op),
        origin: 'openapi',
        articleHtml: renderOperationHtml(op, route, htmlOpts),
      });
    }
  }

  for (const op of model.otherOperations) {
    const route = `/api-reference/operations/${op.operationId}/`;
    pages.push({
      sourceFile: `__nrdocs_api__/operations/${op.operationId}.md`,
      route,
      title: op.summary ?? op.operationId,
      markdownText: renderOperationMarkdown(op),
      origin: 'openapi',
      articleHtml: renderOperationHtml(op, route, htmlOpts),
    });
  }

  for (const schema of model.schemas) {
    const route = `/api-reference/schemas/${schema.schemaId}/`;
    pages.push({
      sourceFile: `__nrdocs_api__/schemas/${schema.schemaId}.md`,
      route,
      title: schema.schemaId,
      markdownText: renderSchemaMarkdown(schema),
      origin: 'openapi',
      articleHtml: renderSchemaHtml(schema, route, htmlOpts),
    });
  }

  return pages;
}

function buildNavSection(model: NormalizedOpenApi): PublicationNavNode {
  const tagChildren: PublicationNavNode[] = [];

  for (const group of model.tagGroups) {
    const opNodes: PublicationNavNode[] = [];
    for (const op of group.operations) {
      const route = `/api-reference/operations/${op.operationId}/`;
      const sourceFile = `__nrdocs_api__/operations/${op.operationId}.md`;
      const title = op.summary ?? op.operationId;
      opNodes.push({
        kind: 'page',
        title,
        depth: 3,
        sourceFile,
        route,
        children: [],
      });
    }
    tagChildren.push({
      kind: 'section-heading',
      title: group.name,
      depth: 2,
      children: opNodes,
    });
  }

  if (model.otherOperations.length > 0) {
    const opNodes: PublicationNavNode[] = [];
    for (const op of model.otherOperations) {
      const route = `/api-reference/operations/${op.operationId}/`;
      const sourceFile = `__nrdocs_api__/operations/${op.operationId}.md`;
      const title = op.summary ?? op.operationId;
      opNodes.push({
        kind: 'page',
        title,
        depth: 3,
        sourceFile,
        route,
        children: [],
      });
    }
    tagChildren.push({
      kind: 'section-heading',
      title: 'Other',
      depth: 2,
      children: opNodes,
    });
  }

  if (model.schemas.length > 0) {
    const schemaNodes: PublicationNavNode[] = [];
    for (const schema of model.schemas) {
      const route = `/api-reference/schemas/${schema.schemaId}/`;
      const sourceFile = `__nrdocs_api__/schemas/${schema.schemaId}.md`;
      schemaNodes.push({
        kind: 'page',
        title: schema.schemaId,
        depth: 3,
        sourceFile,
        route,
        children: [],
      });
    }
    tagChildren.push({
      kind: 'section-heading',
      title: 'Schemas',
      depth: 2,
      children: schemaNodes,
    });
  }

  return {
    kind: 'page',
    title: 'API Reference',
    depth: 1,
    sourceFile: '__nrdocs_api__/index.md',
    route: '/api-reference/',
    children: tagChildren,
  };
}

/**
 * Re-render OpenAPI article HTML after additional known routes/attachments are available.
 */
export function refreshOpenApiArticleHtml(
  integration: OpenApiIntegration,
  options?: OpenApiIntegrationOptions,
): void {
  const htmlOpts = htmlOptions(integration.model, options);
  const refreshed = renderOpenApiPages(integration.model, htmlOpts);
  const byRoute = new Map(refreshed.map((p) => [p.route, p]));
  for (const page of integration.pages) {
    const next = byRoute.get(page.route);
    if (next?.articleHtml !== undefined) page.articleHtml = next.articleHtml;
  }
}

/**
 * Load, validate, normalize, and render OpenAPI into publication pages + nav.
 */
export async function buildOpenApiIntegration(
  rootDir: string,
  specification: string,
  options?: OpenApiIntegrationOptions,
): Promise<OpenApiIntegration> {
  const loaded = await loadOpenApi(rootDir, specification);
  const validated = validateOpenApi(loaded.document, loaded.entryPath);
  const model = normalizeOpenApi(validated, loaded.entryPath);
  const bundledJson = bundleOpenApiJson(validated.document);
  const htmlOpts = htmlOptions(model, options);
  const pages = renderOpenApiPages(model, htmlOpts);
  const navSection = buildNavSection(model);

  return {
    model,
    navSection,
    pages,
    sourcePaths: loaded.sourcePaths,
    bundledJson,
    openapiDownload: {
      route: '/api-reference/openapi.json',
      object: 'openapi/openapi.json',
      mediaType: 'application/vnd.nrdocs.openapi+json',
      filename: 'openapi.json',
    },
  };
}
