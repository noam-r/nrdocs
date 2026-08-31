/** Stable OpenAPI diagnostic machine codes (doc 12 §15). */

export type OpenApiErrorCode =
  | 'openapi_unsupported_version'
  | 'openapi_invalid_document'
  | 'openapi_remote_ref'
  | 'openapi_ref_resolution'
  | 'openapi_unsupported_construct'
  | 'openapi_operation_id'
  | 'openapi_schema_id'
  | 'openapi_route_collision'
  | 'openapi_limit_exceeded'
  | 'openapi_extension_invalid'
  | 'openapi_link_invalid';

export class OpenApiError extends Error {
  readonly code: OpenApiErrorCode;
  readonly sourceFile?: string;
  readonly pointer?: string;
  readonly method?: string;
  readonly path?: string;

  constructor(
    code: OpenApiErrorCode,
    message: string,
    loc?: {
      sourceFile?: string;
      pointer?: string;
      method?: string;
      path?: string;
    },
  ) {
    super(message);
    this.name = 'OpenApiError';
    this.code = code;
    if (loc?.sourceFile !== undefined) this.sourceFile = loc.sourceFile;
    if (loc?.pointer !== undefined) this.pointer = loc.pointer;
    if (loc?.method !== undefined) this.method = loc.method;
    if (loc?.path !== undefined) this.path = loc.path;
  }
}
