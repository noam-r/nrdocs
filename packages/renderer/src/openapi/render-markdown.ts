import { canonicalizeRequestLang, requestLangLabel } from './request-langs.js';
import type {
  NormalizedOpenApi,
  NormalizedOperation,
  NormalizedSchemaPage,
  OpenApiCost,
  OpenApiSchemaNode,
} from './types.js';

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

function schemaType(schema?: OpenApiSchemaNode): string {
  if (!schema) return '';
  if (schema.ref) return schema.ref;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return schema.type ?? '';
}

function renderSchemaMd(schema: OpenApiSchemaNode | undefined, depth = 0): string {
  if (!schema || depth > 4) {
    return schema?.ref ? `\`${schema.ref}\`` : '';
  }
  const lines: string[] = [];
  const t = schemaType(schema);
  if (t) lines.push(`- Type: \`${t}\``);
  if (schema.description) lines.push(`- Description: ${schema.description}`);
  if (schema.enum) {
    lines.push(`- Enum: ${schema.enum.map((v) => `\`${JSON.stringify(v)}\``).join(', ')}`);
  }
  if (schema.const !== undefined) lines.push(`- Const: \`${JSON.stringify(schema.const)}\``);
  if (schema.default !== undefined) lines.push(`- Default: \`${JSON.stringify(schema.default)}\``);
  if (schema.example !== undefined) lines.push(`- Example: \`${JSON.stringify(schema.example)}\``);
  if (schema.readOnly) lines.push('- readOnly: true');
  if (schema.writeOnly) lines.push('- writeOnly: true');
  if (schema.discriminator) {
    lines.push(`- Discriminator: \`${schema.discriminator.propertyName}\``);
    if (schema.discriminator.mapping) {
      for (const [key, target] of Object.entries(schema.discriminator.mapping)) {
        lines.push(`  - \`${key}\` → \`${target}\``);
      }
    }
  }
  if (schema.constraints?.length) {
    for (const c of schema.constraints) lines.push(`- ${c}`);
  }
  if (schema.properties) {
    lines.push('- Properties:');
    const required = new Set(schema.required ?? []);
    for (const [name, prop] of Object.entries(schema.properties)) {
      lines.push(
        `  - \`${name}\`${required.has(name) ? ' (required)' : ''}: \`${schemaType(prop)}\``,
      );
      if (
        prop.enum ||
        prop.const !== undefined ||
        prop.default !== undefined ||
        prop.example !== undefined ||
        prop.readOnly ||
        prop.writeOnly ||
        prop.discriminator ||
        (prop.constraints?.length ?? 0) > 0 ||
        prop.properties ||
        prop.allOf ||
        prop.oneOf ||
        prop.anyOf
      ) {
        const nested = renderSchemaMd(prop, depth + 1);
        if (nested) {
          for (const line of nested.split('\n')) {
            if (line) lines.push(`    ${line}`);
          }
        }
      }
    }
  }
  if (schema.allOf?.length) {
    lines.push('- allOf:');
    for (const s of schema.allOf) lines.push(renderSchemaMd(s, depth + 1));
  }
  if (schema.oneOf?.length) {
    lines.push('- oneOf:');
    for (const s of schema.oneOf) lines.push(renderSchemaMd(s, depth + 1));
  }
  if (schema.anyOf?.length) {
    lines.push('- anyOf:');
    for (const s of schema.anyOf) lines.push(renderSchemaMd(s, depth + 1));
  }
  if (schema.not) lines.push(`- not: \`${schemaType(schema.not)}\``);
  return lines.join('\n');
}

/** Agent Markdown for the API Reference landing page. */
export function renderLandingMarkdown(model: NormalizedOpenApi): string {
  const lines: string[] = [];
  lines.push(`# ${model.info.title}`);
  lines.push('');
  lines.push(`Version: ${model.info.version}`);
  lines.push('');
  if (model.info.description) {
    lines.push(model.info.description);
    lines.push('');
  }
  if (model.servers.length) {
    lines.push('## Servers');
    lines.push('');
    for (const s of model.servers) {
      lines.push(`- \`${s.url}\`${s.description ? ` — ${s.description}` : ''}`);
    }
    lines.push('');
  }
  if (model.securitySchemes.length) {
    lines.push('## Authentication');
    lines.push('');
    for (const s of model.securitySchemes) {
      lines.push(`- **${s.name}** (${s.type})${s.description ? ` — ${s.description}` : ''}`);
    }
    lines.push('');
  }
  lines.push('## Download OpenAPI');
  lines.push('');
  lines.push('Download: `/api-reference/openapi.json`');
  lines.push('');
  lines.push('## Operations');
  lines.push('');
  for (const group of model.tagGroups) {
    lines.push(`### ${group.name}`);
    lines.push('');
    for (const op of group.operations) {
      lines.push(
        `- \`${op.method.toUpperCase()}\` ${op.summary ?? op.operationId} → \`/api-reference/operations/${op.operationId}/\``,
      );
    }
    lines.push('');
  }
  if (model.otherOperations.length) {
    lines.push('### Other');
    lines.push('');
    for (const op of model.otherOperations) {
      lines.push(
        `- \`${op.method.toUpperCase()}\` ${op.summary ?? op.operationId} → \`/api-reference/operations/${op.operationId}/\``,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** Agent Markdown for an operation page. */
export function renderOperationMarkdown(op: NormalizedOperation): string {
  const lines: string[] = [];
  const title = op.summary ?? op.operationId;
  lines.push(`# ${title}`);
  lines.push('');
  if (op.deprecated) {
    lines.push('Deprecated: yes');
    lines.push('');
  }
  lines.push(`- Method: \`${op.method.toUpperCase()}\``);
  lines.push(`- Path: \`${op.path}\``);
  lines.push(`- Operation ID: \`${op.operationId}\``);
  lines.push(`- Cost: ${costLabel(op.cost)}`);
  if (op.cost.type === 'variable') {
    lines.push(`- Cost details: ${op.cost.description}`);
    if (op.cost.pricingUrl) lines.push(`- Pricing: ${op.cost.pricingUrl}`);
  }
  lines.push('');
  if (op.description) {
    lines.push(op.description);
    lines.push('');
  }
  if (op.externalDocs) {
    lines.push(
      `External docs: [${op.externalDocs.description ?? op.externalDocs.url}](${op.externalDocs.url})`,
    );
    lines.push('');
  }
  if (op.servers.length) {
    lines.push('## Servers');
    lines.push('');
    for (const s of op.servers) lines.push(`- \`${s.url}\``);
    lines.push('');
  }
  if (op.security.length) {
    lines.push('## Authentication');
    lines.push('');
    for (const req of op.security) {
      const names = Object.keys(req);
      lines.push(`- ${names.length === 0 ? 'Optional' : names.join(', ')}`);
    }
    lines.push('');
  }
  if (op.parameters.length) {
    lines.push('## Parameters');
    lines.push('');
    for (const p of op.parameters) {
      lines.push(
        `- \`${p.name}\` in \`${p.in}\`${p.required ? ' (required)' : ''}: \`${schemaType(p.schema)}\`${p.description ? ` — ${p.description}` : ''}`,
      );
    }
    lines.push('');
  }
  if (op.requestBody) {
    lines.push('## Request');
    lines.push('');
    lines.push(`Required: ${op.requestBody.required ? 'yes' : 'no'}`);
    lines.push('');
    if (op.requestBody.description) {
      lines.push(op.requestBody.description);
      lines.push('');
    }
    for (const mt of op.requestBody.content) {
      lines.push(`### ${mt.mediaType}`);
      lines.push('');
      const body = renderSchemaMd(mt.schema);
      if (body) {
        lines.push(body);
        lines.push('');
      }
    }
  }
  if (op.responses.length) {
    lines.push('## Response');
    lines.push('');
    for (const resp of op.responses) {
      lines.push(`### ${resp.status}`);
      lines.push('');
      if (resp.description) {
        lines.push(resp.description);
        lines.push('');
      }
      if (resp.headers?.length) {
        lines.push('#### Headers');
        lines.push('');
        for (const h of resp.headers) {
          lines.push(
            `- \`${h.name}\`: \`${schemaType(h.schema)}\`${h.description ? ` — ${h.description}` : ''}`,
          );
        }
        lines.push('');
      }
      for (const mt of resp.content) {
        lines.push(`#### ${mt.mediaType}`);
        lines.push('');
        const body = renderSchemaMd(mt.schema);
        if (body) {
          lines.push(body);
          lines.push('');
        }
      }
    }
  }
  lines.push('## Examples');
  lines.push('');

  const byLang = new Map<string, (typeof op.codeSamples)[number]>();
  for (const sample of op.codeSamples) {
    const key = canonicalizeRequestLang(sample.lang);
    if (!byLang.has(key)) byLang.set(key, sample);
  }

  const baselines: Array<{ key: string; fence: string; source: string }> = [
    { key: 'curl', fence: 'bash', source: op.examples.curl },
    { key: 'javascript', fence: 'javascript', source: op.examples.javascript },
    { key: 'http', fence: 'http', source: op.examples.http },
  ];
  for (const baseline of baselines) {
    const override = byLang.get(baseline.key);
    byLang.delete(baseline.key);
    lines.push(`### ${requestLangLabel(baseline.key)}`);
    lines.push('');
    lines.push(`\`\`\`${override ? override.lang : baseline.fence}`);
    lines.push((override ? override.source : baseline.source).replace(/\n$/, ''));
    lines.push('```');
    lines.push('');
  }
  for (const [key, sample] of byLang) {
    lines.push(`### ${requestLangLabel(key)}`);
    lines.push('');
    lines.push(`\`\`\`${sample.lang}`);
    lines.push(sample.source.replace(/\n$/, ''));
    lines.push('```');
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** Agent Markdown for a schema page. */
export function renderSchemaMarkdown(page: NormalizedSchemaPage): string {
  const lines: string[] = [];
  lines.push(`# ${page.schemaId}`);
  lines.push('');
  const body = renderSchemaMd(page.schema);
  if (body) lines.push(body);
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
