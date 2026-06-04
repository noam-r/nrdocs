/**
 * Typed HTTP client for the nrdocs Worker API.
 * Uses native fetch — no external dependencies.
 */

import {
  buildApiUrl,
  extractFetchError,
  normalizeApiBaseUrl,
  type ApiErrorInfo,
} from './errors.js';

export type { ApiErrorInfo };

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: ApiErrorInfo;
  url?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 120_000;

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    const { url, strippedApiSuffix } = normalizeApiBaseUrl(baseUrl);
    this.baseUrl = url;
    if (strippedApiSuffix) {
      console.warn(
        'Warning: api_url should be the site base (e.g. https://docs.example.com), not …/api — stripped trailing /api',
      );
    }
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private headers(contentType = 'application/json'): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': contentType,
    };
  }

  private async parseJsonResponse(
    res: Response,
    url: string,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: ApiErrorInfo }> {
    const contentType = res.headers?.get?.('Content-Type') ?? '';
    let text: string;
    try {
      text = await res.text();
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid_response',
          message: 'Could not read response body',
          status: res.status,
          url,
        },
      };
    }

    if (contentType && !contentType.includes('json')) {
      return {
        ok: false,
        error: {
          code: 'invalid_response',
          message: `Expected JSON, got ${contentType}`,
          status: res.status,
          url,
          responseBody: text,
        },
      };
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: {
          code: 'invalid_response',
          message: 'Response body is not valid JSON',
          status: res.status,
          url,
          responseBody: text,
        },
      };
    }

    if (json['ok'] === true) {
      return { ok: true, data: json['data'] };
    }

    const err = json['error'] as
      | { code: string; message: string; details?: Record<string, unknown> }
      | undefined;
    return {
      ok: false,
      error: {
        code: err?.code ?? 'unknown',
        message: err?.message ?? `HTTP ${res.status}`,
        status: res.status,
        url,
      },
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ApiResponse<T>> {
    const url = buildApiUrl(this.baseUrl, path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = {
      method,
      headers: this.headers(),
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, init);
      clearTimeout(timer);
      const parsed = await this.parseJsonResponse(res, url);
      if (parsed.ok) {
        return { ok: true, status: res.status, data: parsed.data as T, url };
      }
      return { ok: false, status: res.status, error: parsed.error, url };
    } catch (e) {
      clearTimeout(timer);
      const extracted = extractFetchError(e);
      const code = extracted.kind === 'timeout' ? 'timeout' : 'network_error';
      return {
        ok: false,
        status: 0,
        url,
        error: {
          code,
          message: extracted.message,
          cause: extracted.cause,
          status: 0,
          url,
        },
      };
    }
  }

  async listRepos(filters?: { state?: string; access?: string; owner?: string }): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (filters?.state) params.set('state', filters.state);
    if (filters?.access) params.set('access', filters.access);
    if (filters?.owner) params.set('owner', filters.owner);
    const qs = params.toString();
    return this.request('GET', `/api/repos${qs ? `?${qs}` : ''}`);
  }

  async getRepo(owner: string, repo: string): Promise<ApiResponse> {
    return this.request('GET', `/api/repos/${owner}/${repo}`);
  }

  async approveRepo(owner: string, repo: string, accessMode: string): Promise<ApiResponse> {
    return this.request('POST', `/api/repos/${owner}/${repo}/approve`, {
      access_mode: accessMode,
    });
  }

  async disableRepo(owner: string, repo: string, reason?: string): Promise<ApiResponse> {
    return this.request('POST', `/api/repos/${owner}/${repo}/disable`, {
      reason: reason ?? undefined,
    });
  }

  async setAccess(owner: string, repo: string, accessMode: string): Promise<ApiResponse> {
    return this.request('POST', `/api/repos/${owner}/${repo}/access`, {
      access_mode: accessMode,
    });
  }

  async setPassword(owner: string, repo: string, password: string): Promise<ApiResponse> {
    return this.request('POST', `/api/repos/${owner}/${repo}/password`, {
      password,
    });
  }

  async setSelfPasswordAllow(owner: string, repo: string, allow: boolean): Promise<ApiResponse> {
    const path = allow
      ? `/api/repos/${owner}/${repo}/allow-self-password`
      : `/api/repos/${owner}/${repo}/disallow-self-password`;
    return this.request('POST', path);
  }

  async listRules(): Promise<ApiResponse> {
    return this.request('GET', '/api/auto-approval-rules');
  }

  async addRule(
    pattern: string,
    accessMode: string,
    applyExisting?: boolean,
    defaultAllowSelfPassword?: boolean,
  ): Promise<ApiResponse> {
    const body: Record<string, unknown> = {
      pattern,
      access_mode: accessMode,
      apply_existing: applyExisting ?? false,
    };
    if (defaultAllowSelfPassword !== undefined) {
      body['default_allow_repo_owner_password'] = defaultAllowSelfPassword;
    }
    return this.request('POST', '/api/auto-approval-rules', body);
  }

  async removeRule(ruleId: string): Promise<ApiResponse> {
    return this.request('DELETE', `/api/auto-approval-rules/${ruleId}`);
  }

  async getStatus(owner: string, repo: string): Promise<ApiResponse> {
    return this.request('GET', `/api/repos/${owner}/${repo}`);
  }

  async getOperatorMe(): Promise<ApiResponse> {
    return this.request('GET', '/api/operator/me');
  }

  async publish(formData: FormData, verbose = false): Promise<ApiResponse> {
    const url = buildApiUrl(this.baseUrl, '/api/publish');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);

    if (verbose) {
      console.log(`  POST ${url}`);
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (verbose && res.status) {
        console.log(`  HTTP ${res.status}`);
      }

      const parsed = await this.parseJsonResponse(res, url);
      if (parsed.ok) {
        return { ok: true, status: res.status, data: parsed.data, url };
      }
      return { ok: false, status: res.status, error: parsed.error, url };
    } catch (e) {
      clearTimeout(timer);
      const extracted = extractFetchError(e);
      const code = extracted.kind === 'timeout' ? 'timeout' : 'network_error';
      return {
        ok: false,
        status: 0,
        url,
        error: {
          code,
          message: extracted.message,
          cause: extracted.cause,
          status: 0,
          url,
        },
      };
    }
  }
}
