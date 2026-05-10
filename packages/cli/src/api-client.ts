/**
 * Typed HTTP client for the nrdocs Worker API.
 * Uses native fetch — no external dependencies.
 */

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(url, init);
      const json = (await res.json()) as Record<string, unknown>;
      if (json['ok'] === true) {
        return { ok: true, status: res.status, data: json['data'] as T };
      }
      const err = json['error'] as { code: string; message: string; details?: Record<string, unknown> } | undefined;
      return {
        ok: false,
        status: res.status,
        error: err ?? { code: 'unknown', message: `HTTP ${res.status}` },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, error: { code: 'network_error', message: msg } };
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

  async listRules(): Promise<ApiResponse> {
    return this.request('GET', '/api/auto-approval-rules');
  }

  async addRule(pattern: string, accessMode: string, applyExisting?: boolean): Promise<ApiResponse> {
    return this.request('POST', '/api/auto-approval-rules', {
      pattern,
      access_mode: accessMode,
      apply_existing: applyExisting ?? false,
    });
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

  async publish(formData: FormData): Promise<ApiResponse> {
    const url = `${this.baseUrl}/api/publish`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: formData,
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json['ok'] === true) {
        return { ok: true, status: res.status, data: json['data'] };
      }
      const err = json['error'] as { code: string; message: string; details?: Record<string, unknown> } | undefined;
      return {
        ok: false,
        status: res.status,
        error: err ?? { code: 'unknown', message: `HTTP ${res.status}` },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 0, error: { code: 'network_error', message: msg } };
    }
  }
}
