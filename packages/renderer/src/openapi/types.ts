import type { OpenApiHttpMethod } from './limits.js';

export type OpenApiCost =
  | { type: 'absent' }
  | { type: 'free' }
  | { type: 'fixed'; amount: string; unit: string }
  | { type: 'variable'; description: string; pricingUrl?: string };

export type OpenApiCodeSample = {
  lang: string;
  label?: string;
  source: string;
};

export type OpenApiServer = {
  url: string;
  description?: string;
};

export type OpenApiSecurityScheme = {
  name: string;
  type: string;
  description?: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  paramName?: string;
  openIdConnectUrl?: string;
  flows?: unknown;
};

export type OpenApiSecurityRequirement = Record<string, string[]>;

export type OpenApiSchemaNode = {
  /** Named component key when this is a canonical schema page target. */
  schemaId?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  examples?: unknown;
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  required?: string[];
  properties?: Record<string, OpenApiSchemaNode>;
  additionalProperties?: boolean | OpenApiSchemaNode;
  items?: OpenApiSchemaNode;
  allOf?: OpenApiSchemaNode[];
  oneOf?: OpenApiSchemaNode[];
  anyOf?: OpenApiSchemaNode[];
  not?: OpenApiSchemaNode;
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  /** Local named $ref target (components/schemas key). */
  ref?: string;
  /** Constraint notes (e.g. pattern, min/max) for display. */
  constraints?: string[];
  /** Bounded recursion marker: linked rather than expanded. */
  recursiveRef?: string;
};

export type OpenApiParameter = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  deprecated: boolean;
  description?: string;
  schema?: OpenApiSchemaNode;
  example?: unknown;
  examples?: unknown;
};

export type OpenApiMediaType = {
  mediaType: string;
  schema?: OpenApiSchemaNode;
  example?: unknown;
  examples?: unknown;
};

export type OpenApiRequestBody = {
  description?: string;
  required: boolean;
  content: OpenApiMediaType[];
};

export type OpenApiResponse = {
  status: string;
  description?: string;
  content: OpenApiMediaType[];
  headers?: Array<{ name: string; description?: string; schema?: OpenApiSchemaNode }>;
};

export type OpenApiOperationExamples = {
  http: string;
  curl: string;
  javascript: string;
};

export type NormalizedOperation = {
  operationId: string;
  method: OpenApiHttpMethod;
  path: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  tags: string[];
  /** First applicable tag for navigation grouping; null means Other. */
  primaryTag: string | null;
  servers: OpenApiServer[];
  /** Server URL used for generated examples. */
  exampleServerUrl: string;
  security: OpenApiSecurityRequirement[];
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: OpenApiResponse[];
  cost: OpenApiCost;
  codeSamples: OpenApiCodeSample[];
  examples: OpenApiOperationExamples;
  externalDocs?: { url: string; description?: string };
};

export type NormalizedSchemaPage = {
  schemaId: string;
  schema: OpenApiSchemaNode;
};

export type NormalizedTagGroup = {
  name: string;
  description?: string;
  operations: NormalizedOperation[];
};

export type NormalizedOpenApi = {
  openapiVersion: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
    termsOfService?: string;
    externalDocs?: { url: string; description?: string };
  };
  servers: OpenApiServer[];
  security: OpenApiSecurityRequirement[];
  securitySchemes: OpenApiSecurityScheme[];
  /** Tag groups in nav order (top-level tags, then first-seen extras). Empty groups omitted. */
  tagGroups: NormalizedTagGroup[];
  /** Untagged operations under fixed chrome group Other. */
  otherOperations: NormalizedOperation[];
  /** All operations in navigation / prev-next order. */
  operations: NormalizedOperation[];
  /** Referenced named schemas, lexicographic by id. */
  schemas: NormalizedSchemaPage[];
  /** Root defaults from x-nrdocs-costs. */
  rootCostDefaults: { unit?: string; pricingUrl?: string };
};
