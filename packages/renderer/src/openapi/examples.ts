import type { NormalizedOperation, OpenApiParameter, OpenApiSchemaNode } from './types.js';

function placeholderForSchema(schema?: OpenApiSchemaNode): unknown {
  if (!schema) return '"string"';
  if (schema.example !== undefined) return schema.example;
  if (
    schema.examples !== undefined &&
    typeof schema.examples === 'object' &&
    !Array.isArray(schema.examples)
  ) {
    const first = Object.values(schema.examples as Record<string, unknown>)[0];
    if (isPlainObject(first) && first.value !== undefined) return first.value;
  }
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.ref) return `{ /* ${schema.ref} */ }`;

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.includes('object') || schema.properties) {
    const obj: Record<string, unknown> = {};
    if (schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        obj[k] = unwrapPlaceholder(placeholderForSchema(v));
      }
    }
    return obj;
  }
  if (types.includes('array') || schema.items) {
    return [unwrapPlaceholder(placeholderForSchema(schema.items))];
  }
  if (types.includes('integer') || types.includes('number')) return 0;
  if (types.includes('boolean')) return true;
  if (types.includes('null')) return null;
  return 'string';
}

function unwrapPlaceholder(v: unknown): unknown {
  return v;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function declaredExample(param: OpenApiParameter): unknown | undefined {
  if (param.example !== undefined) return param.example;
  if (param.examples !== undefined && isPlainObject(param.examples)) {
    const first = Object.values(param.examples)[0];
    if (isPlainObject(first) && first.value !== undefined) return first.value;
  }
  if (param.schema?.example !== undefined) return param.schema.example;
  return undefined;
}

function paramValue(param: OpenApiParameter): { value: string; synthesized: boolean } {
  const declared = declaredExample(param);
  if (declared !== undefined) {
    return { value: stringifyValue(declared), synthesized: false };
  }
  // Synthesized placeholders must never look like credentials
  if (param.in === 'header' && param.name.toLowerCase() === 'authorization') {
    return { value: 'Bearer <token>', synthesized: true };
  }
  if (param.in === 'header' && /api-?key|token|secret|password|auth/i.test(param.name)) {
    return { value: '<api-key>', synthesized: true };
  }
  if (param.in === 'query' && /api-?key|token|secret|password/i.test(param.name)) {
    return { value: '<api-key>', synthesized: true };
  }
  const ph = placeholderForSchema(param.schema);
  if (typeof ph === 'string' || typeof ph === 'number' || typeof ph === 'boolean') {
    return { value: String(ph), synthesized: true };
  }
  return { value: stringifyValue(ph), synthesized: true };
}

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function bodyExample(op: NormalizedOperation): {
  body: string | null;
  contentType: string | null;
  synthesized: boolean;
} {
  const rb = op.requestBody;
  if (!rb || rb.content.length === 0) return { body: null, contentType: null, synthesized: false };
  return mediaTypeExample(rb.content[0]!);
}

function mediaTypeExample(mt: {
  mediaType: string;
  schema?: OpenApiSchemaNode;
  example?: unknown;
  examples?: unknown;
}): { body: string; contentType: string; synthesized: boolean } {
  if (mt.example !== undefined) {
    return {
      body: typeof mt.example === 'string' ? mt.example : JSON.stringify(mt.example, null, 2),
      contentType: mt.mediaType,
      synthesized: false,
    };
  }
  if (mt.examples && isPlainObject(mt.examples)) {
    const first = Object.values(mt.examples)[0];
    if (isPlainObject(first) && first.value !== undefined) {
      const v = first.value;
      return {
        body: typeof v === 'string' ? v : JSON.stringify(v, null, 2),
        contentType: mt.mediaType,
        synthesized: false,
      };
    }
  }
  if (mt.schema?.example !== undefined) {
    const v = mt.schema.example;
    return {
      body: typeof v === 'string' ? v : JSON.stringify(v, null, 2),
      contentType: mt.mediaType,
      synthesized: false,
    };
  }
  const ph = placeholderForSchema(mt.schema);
  return {
    body: JSON.stringify(ph, null, 2),
    contentType: mt.mediaType,
    synthesized: true,
  };
}

/** One example body per response status that has a media type (declared or synthesized). */
export function generateResponseExamples(
  op: NormalizedOperation,
): Array<{ status: string; body: string; contentType: string; lang: string }> {
  const out: Array<{ status: string; body: string; contentType: string; lang: string }> = [];
  for (const resp of op.responses) {
    if (resp.content.length === 0) continue;
    const mt = resp.content[0]!;
    const ex = mediaTypeExample(mt);
    const lang =
      /json/i.test(ex.contentType) ||
      ex.body.trimStart().startsWith('{') ||
      ex.body.trimStart().startsWith('[')
        ? 'json'
        : 'plaintext';
    out.push({ status: resp.status, body: ex.body, contentType: ex.contentType, lang });
  }
  return out;
}

/**
 * Generate deterministic request samples for an operation (same request, three languages).
 * Declared examples are copied verbatim; synthesized placeholders never look like credentials.
 */
export function generateOperationExamples(op: NormalizedOperation): {
  http: string;
  curl: string;
  javascript: string;
} {
  const method = op.method.toUpperCase();
  const server = op.exampleServerUrl.replace(/\/$/, '');
  let path = op.path;

  const query: string[] = [];
  const headers: Array<{ name: string; value: string }> = [];
  const cookies: string[] = [];

  for (const param of op.parameters) {
    const { value } = paramValue(param);
    if (param.in === 'path') {
      path = path.replace(
        new RegExp(`\\{${escapeRegExp(param.name)}\\}`, 'g'),
        encodeURIComponent(value),
      );
    } else if (param.in === 'query') {
      query.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(value)}`);
    } else if (param.in === 'header') {
      headers.push({ name: param.name, value });
    } else if (param.in === 'cookie') {
      cookies.push(`${param.name}=${value}`);
    }
  }

  // Security scheme placeholders (synthesized)
  for (const req of op.security) {
    for (const schemeName of Object.keys(req)) {
      // Generic safe placeholder; detailed scheme rendering is on the page
      if (!headers.some((h) => h.name.toLowerCase() === 'authorization')) {
        headers.push({ name: 'Authorization', value: 'Bearer <token>' });
      }
      void schemeName;
      break;
    }
  }

  if (cookies.length) {
    headers.push({ name: 'Cookie', value: cookies.join('; ') });
  }

  const { body, contentType } = bodyExample(op);
  if (contentType && body !== null) {
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: contentType });
    }
  }

  const queryStr = query.length ? `?${query.join('&')}` : '';
  const urlPath = `${path}${queryStr}`;

  const httpLines = [`${method} ${urlPath} HTTP/1.1`, `Host: ${hostOf(server)}`];
  for (const h of headers) {
    httpLines.push(`${h.name}: ${h.value}`);
  }
  if (body !== null) {
    httpLines.push('', body);
  }
  const http = httpLines.join('\n');

  const curlParts = [`curl -X ${method} '${server}${urlPath}'`];
  for (const h of headers) {
    curlParts.push(`  -H '${escapeShell(h.name)}: ${escapeShell(h.value)}'`);
  }
  if (body !== null) {
    curlParts.push(`  -d '${escapeShell(body)}'`);
  }
  const curl = curlParts.join(' \\\n');

  const jsHeaderLines = headers.map((h) => `    '${escapeJs(h.name)}': '${escapeJs(h.value)}'`);
  const jsLines = [`await fetch('${escapeJs(`${server}${urlPath}`)}', {`, `  method: '${method}',`];
  if (jsHeaderLines.length > 0) {
    jsLines.push(`  headers: {`, jsHeaderLines.join(',\n'), `  },`);
  }
  if (body !== null) {
    const jsBody = contentType && /json/i.test(contentType) ? body : JSON.stringify(body);
    jsLines.push(`  body: ${jsBody},`);
  }
  jsLines.push(`});`);
  const javascript = jsLines.join('\n');

  return { http, curl, javascript };
}

function hostOf(server: string): string {
  try {
    return new URL(server).host || 'api.example.com';
  } catch {
    return 'api.example.com';
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeShell(s: string): string {
  return s.replace(/'/g, `'\\''`);
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
