/** OpenAPI-specific resource limits (doc 12 §14). */

export const OPENAPI_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
export const OPENAPI_TOTAL_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const OPENAPI_MAX_DEPENDENCY_FILES = 64;
export const OPENAPI_MAX_REF_DEPTH = 32;
export const OPENAPI_MAX_PARSED_NODES = 500_000;
export const OPENAPI_MAX_OPERATIONS = 200;
export const OPENAPI_MAX_TAGS = 100;
export const OPENAPI_MAX_SCHEMA_PAGES = 200;
export const OPENAPI_MAX_PARAMETERS_PER_OPERATION = 100;
export const OPENAPI_MAX_RESPONSES_PER_OPERATION = 50;
export const OPENAPI_MAX_MEDIA_TYPES = 8;
export const OPENAPI_MAX_EXAMPLES_PER_OPERATION = 32;
export const OPENAPI_MAX_CODE_SAMPLES = 8;
export const OPENAPI_MAX_CODE_SAMPLE_BYTES = 16_384;
export const OPENAPI_BUNDLED_MAX_BYTES = 5 * 1024 * 1024;

export const OPENAPI_OPERATION_ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
export const OPENAPI_SCHEMA_ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
export const OPENAPI_CODE_SAMPLE_LANG_RE = /^[a-z][a-z0-9+-]{0,31}$/;
export const OPENAPI_COST_UNIT_RE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;

export const OPENAPI_HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type OpenApiHttpMethod = (typeof OPENAPI_HTTP_METHODS)[number];
