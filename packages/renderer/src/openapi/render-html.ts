import { createHash } from 'node:crypto';
import { escapeAttr, escapeHtml } from '../escape.js';
import { highlightCode } from '../highlight.js';
import { loadAndNormalizeMarkdown } from '../markdown-scan.js';
import { renderArticleHtml, type LinkResolver } from '../mdast-to-html.js';
import { routeRelativeHref } from '../relative-href.js';
import { RendererError } from '../types.js';
import { OpenApiError } from './errors.js';
import { generateResponseExamples } from './examples.js';
import {
  canonicalizeRequestLang,
  requestHighlightLang,
  requestLangLabel,
} from './request-langs.js';
import type {
  NormalizedOpenApi,
  NormalizedOperation,
  NormalizedSchemaPage,
  OpenApiCost,
  OpenApiSchemaNode,
} from './types.js';

export type OpenApiHtmlRenderOptions = {
  knownRoutes?: Set<string>;
  knownAttachments?: Set<string>;
};

function costLabel(cost: OpenApiCost): string {
  switch (cost.type) {
    case 'free':
      return 'Free';
    case 'absent':
      return 'Not specified';
    case 'fixed':
      return `${cost.amount} ${cost.unit} per request`;
    case 'variable':
      return 'Variable cost';
  }
}

function splitHref(href: string): { pathOnly: string; fragment: string } {
  const hash = href.indexOf('#');
  if (hash === -1) return { pathOnly: href.split('?')[0]!, fragment: '' };
  return { pathOnly: href.slice(0, hash).split('?')[0]!, fragment: href.slice(hash + 1) };
}

function normalizePageRoute(pathOnly: string): string {
  if (pathOnly === '/api-reference/openapi.json') return pathOnly;
  if (!pathOnly) return '/';
  return pathOnly.endsWith('/') ? pathOnly : `${pathOnly}/`;
}

/** Resolve a link as if from logical base `/api-reference/`. */
function resolveFromApiReferenceBase(href: string): { pathname: string; fragment: string } | null {
  const { pathOnly, fragment } = splitHref(href);
  if (!pathOnly) return fragment ? { pathname: '', fragment } : null;

  let pathname: string;
  if (pathOnly.startsWith('/')) {
    pathname = pathOnly;
  } else {
    try {
      pathname = new URL(pathOnly, 'https://nrdocs.local/api-reference/').pathname;
    } catch {
      return null;
    }
  }
  return { pathname, fragment };
}

function openApiLinkResolver(
  pageRoute: string,
  knownRoutes?: Set<string>,
  knownAttachments?: Set<string>,
): LinkResolver {
  return {
    resolvePageHref(href: string): string | null {
      const resolved = resolveFromApiReferenceBase(href);
      if (resolved === null) return null;
      if (!resolved.pathname) return resolved.fragment ? `#${resolved.fragment}` : null;
      const route = normalizePageRoute(resolved.pathname);
      const fragment = resolved.fragment ? `#${resolved.fragment}` : '';
      if (!knownRoutes || !knownRoutes.has(route)) return null;
      return routeRelativeHref(pageRoute, route) + fragment;
    },
    resolveAssetHref(): string | null {
      return null;
    },
    resolveAttachmentHref(href: string): string | null {
      const resolved = resolveFromApiReferenceBase(href);
      if (resolved === null || !resolved.pathname) return null;
      if (!knownAttachments || !knownAttachments.has(resolved.pathname)) return null;
      return routeRelativeHref(pageRoute, resolved.pathname);
    },
  };
}

/**
 * Safe Markdown for OpenAPI description fields (doc 12 §10).
 * Relative links resolve from `/api-reference/`; images are rejected.
 */
function mdToSafeHtml(
  text: string | undefined,
  pageRoute: string,
  knownRoutes: Set<string> | undefined,
  locHint: string,
  knownAttachments?: Set<string>,
): string {
  if (!text) return '';
  const sourceFile = `__nrdocs_api__/index.md`;
  let tree;
  try {
    ({ tree } = loadAndNormalizeMarkdown(new TextEncoder().encode(text), sourceFile));
  } catch (error) {
    if (error instanceof RendererError) {
      throw new OpenApiError('openapi_link_invalid', `${error.message}\n  in ${locHint}`, {
        sourceFile,
      });
    }
    throw error;
  }

  // Fail closed on images (must be validated publication assets; v1 rejects all).
  for (const node of walkMdast(tree)) {
    if (node.type === 'image') {
      throw new OpenApiError(
        'openapi_link_invalid',
        `Images are not allowed in OpenAPI descriptions:\n  ${(node as { url?: string }).url ?? ''}\n  in ${locHint}`,
        { sourceFile },
      );
    }
  }

  const links = openApiLinkResolver(pageRoute, knownRoutes, knownAttachments);

  // Pre-validate relative links so unknown targets fail (not broken-link spans).
  for (const node of walkMdast(tree)) {
    if (node.type !== 'link') continue;
    const href = (node as { url?: string }).url ?? '';
    if (!href || href.startsWith('#')) continue;
    try {
      const abs = new URL(href);
      if (abs.protocol === 'http:' || abs.protocol === 'https:' || abs.protocol === 'mailto:') {
        continue;
      }
      throw new OpenApiError(
        'openapi_link_invalid',
        `Unsupported link scheme in OpenAPI description:\n  ${href}\n  in ${locHint}`,
        { sourceFile },
      );
    } catch (error) {
      if (error instanceof OpenApiError) throw error;
    }
    if (links.resolvePageHref(href) === null && links.resolveAttachmentHref(href) === null) {
      throw new OpenApiError(
        'openapi_link_invalid',
        `Invalid relative link in OpenAPI description:\n  ${href}\n  in ${locHint}`,
        { sourceFile },
      );
    }
  }

  try {
    const { html } = renderArticleHtml(tree, sourceFile, links);
    return html;
  } catch (error) {
    if (error instanceof RendererError) {
      throw new OpenApiError('openapi_link_invalid', `${error.message}\n  in ${locHint}`, {
        sourceFile,
      });
    }
    throw error;
  }
}

function* walkMdast(node: {
  type: string;
  children?: unknown[];
}): Generator<{ type: string; url?: string }> {
  yield node as { type: string; url?: string };
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child && typeof child === 'object' && 'type' in child) {
        yield* walkMdast(child as { type: string; children?: unknown[] });
      }
    }
  }
}

function schemaTypeLabel(schema?: OpenApiSchemaNode): string {
  if (!schema) return '';
  if (schema.ref) return schema.ref;
  if (schema.recursiveRef) return schema.recursiveRef;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type ?? '';
}

function schemaLink(
  schema: OpenApiSchemaNode | undefined,
  fromRoute: string,
  knownRoutes?: Set<string>,
): string {
  if (!schema) return '';
  if (schema.ref) {
    const route = `/api-reference/schemas/${schema.ref}/`;
    if (knownRoutes && !knownRoutes.has(route)) {
      return `<code>${escapeHtml(schema.ref)}</code>`;
    }
    const href = routeRelativeHref(fromRoute, route);
    return `<a href="${escapeAttr(href)}"><code>${escapeHtml(schema.ref)}</code></a>`;
  }
  const t = schemaTypeLabel(schema);
  return t ? `<code>${escapeHtml(t)}</code>` : '';
}

function formatJsonValue(value: unknown): string {
  return escapeHtml(JSON.stringify(value));
}

function headingId(index: number, text: string): string {
  const hex = createHash('sha256').update(`${index}:${text}`).digest('hex').slice(0, 16);
  return `nr-h-${hex}`;
}

/** Assign stable nr-h-* ids to heading tags in a fragment. */
function withHeadingIds(html: string): string {
  let index = 0;
  return html.replace(
    /<(h[1-6])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (_m, tag: string, _attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '');
      const id = headingId(index++, text);
      return `<${tag.toLowerCase()} id="${id}">${inner}</${tag.toLowerCase()}>`;
    },
  );
}

/** Same request in language tabs; x-codeSamples override/add by lang, never by label. */
function buildRequestExampleTabs(
  op: NormalizedOperation,
): Array<{ id: string; label: string; body: string }> {
  const byLang = new Map<string, (typeof op.codeSamples)[number]>();
  for (const sample of op.codeSamples) {
    const key = canonicalizeRequestLang(sample.lang);
    if (!byLang.has(key)) byLang.set(key, sample);
  }

  const baselines: Array<{ key: string; source: string; highlight: string }> = [
    { key: 'curl', source: op.examples.curl, highlight: 'bash' },
    { key: 'javascript', source: op.examples.javascript, highlight: 'javascript' },
    { key: 'http', source: op.examples.http, highlight: 'http' },
  ];

  const tabs: Array<{ id: string; label: string; body: string }> = [];
  for (const baseline of baselines) {
    const override = byLang.get(baseline.key);
    byLang.delete(baseline.key);
    tabs.push({
      id: baseline.key,
      label: requestLangLabel(baseline.key),
      body: codeBlock(
        override ? override.source : baseline.source,
        override ? requestHighlightLang(baseline.key, override.lang) : baseline.highlight,
        { copyButton: false },
      ),
    });
  }
  for (const [key, sample] of byLang) {
    tabs.push({
      id: `lang-${key}`,
      label: requestLangLabel(key),
      body: codeBlock(sample.source, sample.lang, { copyButton: false }),
    });
  }
  return tabs;
}

/** Reference-style example card: tab chrome + single Copy control + stacked panels. */
function renderExamplePanel(tabs: Array<{ id: string; label: string; body: string }>): string {
  if (tabs.length === 0) return '';
  const tabBtns = tabs
    .map(
      (t, i) =>
        `<button type="button" class="nr-tab${i === 0 ? ' nr-tab-active' : ''}">${escapeHtml(t.label)}</button>`,
    )
    .join('\n');
  const panels = tabs
    .map(
      (t, i) =>
        `<div class="nr-tab-panel${i === 0 ? ' nr-tab-panel-active' : ''}">\n${t.body}\n</div>`,
    )
    .join('\n');
  return `<div class="nr-api-panel">
<div class="nr-tabs">
<div class="nr-api-panel-chrome">
<div class="nr-tab-list">
${tabBtns}
</div>
<button type="button" class="nr-copy" aria-label="Copy">Copy</button>
</div>
${panels}
</div>
</div>\n`;
}

function codeBlock(code: string, lang: string, opts?: { copyButton?: boolean }): string {
  const { language, innerHtml } = highlightCode(code, lang);
  const copy =
    opts?.copyButton === false
      ? ''
      : `<button type="button" class="nr-copy" aria-label="Copy">Copy</button>`;
  return `<div class="nr-code-block"><pre><code class="language-${escapeAttr(language)}">${innerHtml}</code></pre>${copy}</div>\n`;
}

function renderSchemaSummary(
  schema: OpenApiSchemaNode | undefined,
  fromRoute: string,
  knownRoutes: Set<string> | undefined,
  depth = 0,
  knownAttachments?: Set<string>,
): string {
  if (!schema || depth > 4) {
    if (schema?.ref || schema?.recursiveRef) {
      return schemaLink(schema, fromRoute, knownRoutes);
    }
    return '';
  }
  if (schema.ref && !schema.properties && !schema.allOf && !schema.oneOf && !schema.anyOf) {
    return schemaLink(schema, fromRoute, knownRoutes);
  }
  const parts: string[] = [];
  const type = schemaTypeLabel(schema);
  if (type)
    parts.push(
      `<p>Type: ${schemaLink(schema, fromRoute, knownRoutes) || `<code>${escapeHtml(type)}</code>`}</p>`,
    );
  if (schema.description) {
    parts.push(
      mdToSafeHtml(
        schema.description,
        fromRoute,
        knownRoutes,
        'schema description',
        knownAttachments,
      ),
    );
  }
  if (schema.enum) {
    parts.push(
      `<p>Enum: ${schema.enum.map((v) => `<code>${formatJsonValue(v)}</code>`).join(', ')}</p>`,
    );
  }
  if (schema.const !== undefined) {
    parts.push(`<p>Const: <code>${formatJsonValue(schema.const)}</code></p>`);
  }
  if (schema.default !== undefined) {
    parts.push(`<p>Default: <code>${formatJsonValue(schema.default)}</code></p>`);
  }
  if (schema.example !== undefined) {
    parts.push(`<p>Example: <code>${formatJsonValue(schema.example)}</code></p>`);
  }
  if (schema.readOnly) parts.push('<p>readOnly</p>');
  if (schema.writeOnly) parts.push('<p>writeOnly</p>');
  if (schema.discriminator) {
    parts.push(
      `<p>Discriminator: <code>${escapeHtml(schema.discriminator.propertyName)}</code></p>`,
    );
    if (schema.discriminator.mapping) {
      parts.push('<ul class="nr-api-discriminator-mapping">');
      for (const [key, target] of Object.entries(schema.discriminator.mapping)) {
        let targetHtml = `<code>${escapeHtml(target)}</code>`;
        const schemaId = target.startsWith('#/components/schemas/')
          ? target.slice('#/components/schemas/'.length)
          : target.includes('/')
            ? null
            : target;
        if (schemaId && !schemaId.includes('/')) {
          targetHtml = schemaLink({ ref: schemaId }, fromRoute, knownRoutes) || targetHtml;
        }
        parts.push(`<li><code>${escapeHtml(key)}</code> → ${targetHtml}</li>`);
      }
      parts.push('</ul>');
    }
  }
  if (schema.constraints?.length) {
    parts.push(`<ul>${schema.constraints.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`);
  }
  if (schema.properties) {
    parts.push(
      '<table class="nr-api-table"><thead><tr><th>Property</th><th>Type</th><th>Required</th></tr></thead><tbody>',
    );
    const required = new Set(schema.required ?? []);
    for (const [name, prop] of Object.entries(schema.properties)) {
      parts.push(
        `<tr><td><code>${escapeHtml(name)}</code></td><td>${schemaLink(prop, fromRoute, knownRoutes) || escapeHtml(schemaTypeLabel(prop))}</td><td>${required.has(name) ? 'yes' : ''}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
    for (const [name, prop] of Object.entries(schema.properties)) {
      const nested = renderSchemaSummary(prop, fromRoute, knownRoutes, depth + 1, knownAttachments);
      if (
        nested &&
        (prop.enum ||
          prop.const !== undefined ||
          prop.default !== undefined ||
          prop.example !== undefined ||
          prop.readOnly ||
          prop.writeOnly ||
          prop.discriminator ||
          (prop.constraints?.length ?? 0) > 0)
      ) {
        parts.push(`<h4><code>${escapeHtml(name)}</code></h4>`);
        parts.push(nested);
      }
    }
  }
  if (schema.allOf?.length) {
    parts.push('<p>allOf:</p>');
    for (const s of schema.allOf)
      parts.push(renderSchemaSummary(s, fromRoute, knownRoutes, depth + 1, knownAttachments));
  }
  if (schema.oneOf?.length) {
    parts.push('<p>oneOf:</p>');
    for (const s of schema.oneOf)
      parts.push(renderSchemaSummary(s, fromRoute, knownRoutes, depth + 1, knownAttachments));
  }
  if (schema.anyOf?.length) {
    parts.push('<p>anyOf:</p>');
    for (const s of schema.anyOf)
      parts.push(renderSchemaSummary(s, fromRoute, knownRoutes, depth + 1, knownAttachments));
  }
  if (schema.not) {
    parts.push(
      `<p>not: ${schemaLink(schema.not, fromRoute, knownRoutes) || escapeHtml(schemaTypeLabel(schema.not))}</p>`,
    );
  }
  return parts.join('\n');
}

/** HTML article fragment for the API Reference landing page. */
export function renderLandingHtml(
  model: NormalizedOpenApi,
  pageRoute = '/api-reference/',
  options?: OpenApiHtmlRenderOptions,
): string {
  const knownRoutes = options?.knownRoutes;
  const knownAttachments = options?.knownAttachments;
  const downloadHref = routeRelativeHref(pageRoute, '/api-reference/openapi.json');
  const parts: string[] = [];
  parts.push(`<div class="nr-api-layout">\n<div class="nr-api-primary">\n`);
  parts.push(`<h1>${escapeHtml(model.info.title)}</h1>\n`);
  parts.push(`<p class="nr-api-version">Version ${escapeHtml(model.info.version)}</p>\n`);
  if (model.info.description) {
    parts.push(
      mdToSafeHtml(
        model.info.description,
        pageRoute,
        knownRoutes,
        'info.description',
        knownAttachments,
      ),
    );
  }

  if (model.info.contact) {
    const c = model.info.contact;
    parts.push('<section class="nr-api-contact"><h2>Contact</h2><ul>');
    if (c.name) parts.push(`<li>${escapeHtml(c.name)}</li>`);
    if (c.email) parts.push(`<li>${escapeHtml(c.email)}</li>`);
    if (c.url) parts.push(`<li><a href="${escapeAttr(c.url)}">${escapeHtml(c.url)}</a></li>`);
    parts.push('</ul></section>\n');
  }
  if (model.info.license) {
    const lic = model.info.license.url
      ? `<a href="${escapeAttr(model.info.license.url)}">${escapeHtml(model.info.license.name)}</a>`
      : escapeHtml(model.info.license.name);
    parts.push(`<p>License: ${lic}</p>\n`);
  }
  if (model.info.termsOfService) {
    parts.push(
      `<p>Terms: <a href="${escapeAttr(model.info.termsOfService)}">${escapeHtml(model.info.termsOfService)}</a></p>\n`,
    );
  }
  if (model.info.externalDocs) {
    parts.push(
      `<p><a href="${escapeAttr(model.info.externalDocs.url)}">${escapeHtml(model.info.externalDocs.description ?? model.info.externalDocs.url)}</a></p>\n`,
    );
  }

  if (model.servers.length) {
    parts.push('<section class="nr-api-servers"><h2>Servers</h2><ul>');
    for (const s of model.servers) {
      parts.push(
        `<li><code>${escapeHtml(s.url)}</code>${s.description ? ` — ${escapeHtml(s.description)}` : ''}</li>`,
      );
    }
    parts.push('</ul></section>\n');
  }

  if (model.securitySchemes.length) {
    parts.push('<section class="nr-api-auth"><h2>Authentication</h2><ul>');
    for (const s of model.securitySchemes) {
      const desc = s.description
        ? mdToSafeHtml(
            s.description,
            pageRoute,
            knownRoutes,
            `security ${s.name}`,
            knownAttachments,
          )
        : '';
      parts.push(
        `<li><strong>${escapeHtml(s.name)}</strong> (${escapeHtml(s.type)})${desc ? ` — ${desc}` : ''}</li>`,
      );
    }
    parts.push('</ul></section>\n');
  }

  parts.push(
    `<p class="nr-api-download"><a href="${escapeAttr(downloadHref)}">Download OpenAPI</a></p>\n`,
  );

  parts.push('<section class="nr-api-index"><h2>Operations</h2>\n');
  for (const group of model.tagGroups) {
    parts.push(`<h3>${escapeHtml(group.name)}</h3><ul>`);
    for (const op of group.operations) {
      const href = routeRelativeHref(pageRoute, `/api-reference/operations/${op.operationId}/`);
      const title = op.summary ?? op.operationId;
      parts.push(
        `<li><a href="${escapeAttr(href)}"><code>${escapeHtml(op.method.toUpperCase())}</code> ${escapeHtml(title)}</a></li>`,
      );
    }
    parts.push('</ul>');
  }
  if (model.otherOperations.length) {
    parts.push('<h3>Other</h3><ul>');
    for (const op of model.otherOperations) {
      const href = routeRelativeHref(pageRoute, `/api-reference/operations/${op.operationId}/`);
      const title = op.summary ?? op.operationId;
      parts.push(
        `<li><a href="${escapeAttr(href)}"><code>${escapeHtml(op.method.toUpperCase())}</code> ${escapeHtml(title)}</a></li>`,
      );
    }
    parts.push('</ul>');
  }
  parts.push('</section>\n');
  parts.push('</div>\n</div>\n');
  return withHeadingIds(parts.join(''));
}

/** HTML article fragment for an operation page. */
export function renderOperationHtml(
  op: NormalizedOperation,
  pageRoute: string,
  options?: OpenApiHtmlRenderOptions,
): string {
  const knownRoutes = options?.knownRoutes;
  const knownAttachments = options?.knownAttachments;
  const parts: string[] = [];
  const title = op.summary ?? op.operationId;
  parts.push(`<div class="nr-api-layout">\n`);
  parts.push(`<div class="nr-api-primary">\n`);
  parts.push(`<h1>${escapeHtml(title)}</h1>\n`);
  if (op.deprecated) parts.push(`<p class="nr-api-deprecated">Deprecated</p>\n`);
  parts.push(
    `<div class="nr-api-method-path"><span class="nr-api-method nr-api-method-${escapeAttr(op.method)}">${escapeHtml(op.method.toUpperCase())}</span> <code class="nr-api-path">${escapeHtml(op.path)}</code></div>\n`,
  );
  parts.push(
    `<p class="nr-api-cost"><span class="nr-api-cost-label">Cost</span> ${escapeHtml(costLabel(op.cost))}</p>\n`,
  );
  if (op.cost.type === 'variable') {
    parts.push(`<p>${escapeHtml(op.cost.description)}</p>\n`);
    if (op.cost.pricingUrl) {
      parts.push(
        `<p><a href="${escapeAttr(op.cost.pricingUrl)}">${escapeHtml(op.cost.pricingUrl)}</a></p>\n`,
      );
    }
  }
  if (op.description) {
    parts.push(
      mdToSafeHtml(
        op.description,
        pageRoute,
        knownRoutes,
        `${op.operationId} description`,
        knownAttachments,
      ),
    );
  }
  if (op.externalDocs) {
    parts.push(
      `<p class="nr-api-external-docs"><a href="${escapeAttr(op.externalDocs.url)}">${escapeHtml(op.externalDocs.description ?? op.externalDocs.url)}</a></p>\n`,
    );
  }

  if (op.servers.length) {
    parts.push('<section><h2>Servers</h2><ul>');
    for (const s of op.servers) {
      parts.push(`<li><code>${escapeHtml(s.url)}</code></li>`);
    }
    parts.push('</ul></section>\n');
  }

  if (op.security.length) {
    parts.push('<section><h2>Authentication</h2><ul>');
    for (const req of op.security) {
      const names = Object.keys(req);
      parts.push(`<li>${names.length === 0 ? 'Optional' : escapeHtml(names.join(', '))}</li>`);
    }
    parts.push('</ul></section>\n');
  }

  if (op.parameters.length) {
    parts.push('<section><h2>Parameters</h2>\n');
    parts.push(
      '<table class="nr-api-table"><thead><tr><th>Name</th><th>In</th><th>Required</th><th>Type</th><th>Description</th></tr></thead><tbody>\n',
    );
    for (const p of op.parameters) {
      const desc = p.description
        ? mdToSafeHtml(
            p.description,
            pageRoute,
            knownRoutes,
            `${op.operationId} parameter ${p.name}`,
            knownAttachments,
          )
        : '';
      parts.push(
        `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${escapeHtml(p.in)}</td><td>${p.required ? 'yes' : ''}</td><td>${schemaLink(p.schema, pageRoute, knownRoutes)}</td><td>${desc}</td></tr>\n`,
      );
    }
    parts.push('</tbody></table></section>\n');
  }

  if (op.requestBody) {
    parts.push('<section><h2>Request</h2>\n');
    if (op.requestBody.description) {
      parts.push(
        mdToSafeHtml(
          op.requestBody.description,
          pageRoute,
          knownRoutes,
          `${op.operationId} requestBody`,
          knownAttachments,
        ),
      );
    }
    parts.push(`<p>Required: ${op.requestBody.required ? 'yes' : 'no'}</p>\n`);
    for (const mt of op.requestBody.content) {
      parts.push(`<h3><code>${escapeHtml(mt.mediaType)}</code></h3>\n`);
      parts.push(renderSchemaSummary(mt.schema, pageRoute, knownRoutes, 0, knownAttachments));
    }
    parts.push('</section>\n');
  }

  if (op.responses.length) {
    parts.push('<section><h2>Response</h2>\n');
    for (const resp of op.responses) {
      parts.push(`<h3><code>${escapeHtml(resp.status)}</code></h3>\n`);
      if (resp.description) {
        parts.push(
          mdToSafeHtml(
            resp.description,
            pageRoute,
            knownRoutes,
            `${op.operationId} response ${resp.status}`,
            knownAttachments,
          ),
        );
      }
      if (resp.headers?.length) {
        parts.push('<h4>Headers</h4>\n');
        parts.push(
          '<table class="nr-api-table"><thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead><tbody>\n',
        );
        for (const h of resp.headers) {
          const desc = h.description
            ? mdToSafeHtml(
                h.description,
                pageRoute,
                knownRoutes,
                `${op.operationId} response ${resp.status} header ${h.name}`,
                knownAttachments,
              )
            : '';
          parts.push(
            `<tr><td><code>${escapeHtml(h.name)}</code></td><td>${schemaLink(h.schema, pageRoute, knownRoutes)}</td><td>${desc}</td></tr>\n`,
          );
        }
        parts.push('</tbody></table>\n');
      }
      for (const mt of resp.content) {
        parts.push(`<h4><code>${escapeHtml(mt.mediaType)}</code></h4>\n`);
        parts.push(renderSchemaSummary(mt.schema, pageRoute, knownRoutes, 0, knownAttachments));
      }
    }
    parts.push('</section>\n');
  }

  parts.push(`</div>\n`);
  parts.push(`<div class="nr-api-secondary">\n`);
  parts.push(renderExamplePanel(buildRequestExampleTabs(op)));

  const responseExamples = generateResponseExamples(op);
  if (responseExamples.length > 0) {
    const responseTabs = responseExamples.map((ex) => ({
      id: `resp-${ex.status}`,
      label: ex.status,
      body: codeBlock(ex.body, ex.lang, { copyButton: false }),
    }));
    parts.push(renderExamplePanel(responseTabs));
  }
  parts.push(`</div>\n`);
  parts.push(`</div>\n`);
  return withHeadingIds(parts.join(''));
}

/** HTML article fragment for a schema page. */
export function renderSchemaHtml(
  page: NormalizedSchemaPage,
  pageRoute: string,
  options?: OpenApiHtmlRenderOptions,
): string {
  const parts: string[] = [];
  parts.push(`<div class="nr-api-layout"><div class="nr-api-primary">\n`);
  parts.push(`<h1>${escapeHtml(page.schemaId)}</h1>\n`);
  parts.push(
    renderSchemaSummary(page.schema, pageRoute, options?.knownRoutes, 0, options?.knownAttachments),
  );
  parts.push(`</div></div>\n`);
  return withHeadingIds(parts.join(''));
}
