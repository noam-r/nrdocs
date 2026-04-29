export interface ApiError {
  error: string;
}

export interface BootstrapValidateResponse {
  org_name: string;
  org_slug: string;
  remaining_quota: number;
  expires_at: string;
  delivery_url?: string;
}

export async function bootstrapValidate(
  apiBaseUrl: string,
  bootstrapToken: string,
): Promise<BootstrapValidateResponse> {
  let response: Response;
  const url = `${apiBaseUrl}/bootstrap/init`;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bootstrapToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  } catch (_error: unknown) {
    const reason = _error instanceof Error ? _error.message : 'Unknown error';
    throw new Error(`Could not connect to ${url}: ${reason}`);
  }

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as ApiError;
      errorMessage = body.error;
    } catch {
      errorMessage = 'Unknown error';
    }
    throw new Error(`API request failed (${response.status}): ${errorMessage}`);
  }

  return (await response.json()) as BootstrapValidateResponse;
}

export interface BootstrapOnboardRequest {
  slug: string;
  title: string;
  description: string;
  repo_identity: string;
  access_mode?: 'public' | 'password';
}

export interface BootstrapOnboardResponse {
  project_id: string;
  repo_publish_token: string;
  delivery_url?: string;
  recovered?: boolean;
}

export async function bootstrapOnboard(
  apiBaseUrl: string,
  bootstrapToken: string,
  request: BootstrapOnboardRequest,
): Promise<BootstrapOnboardResponse> {
  let response: Response;
  const url = `${apiBaseUrl}/bootstrap/onboard`;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bootstrapToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch (_error: unknown) {
    const reason = _error instanceof Error ? _error.message : 'Unknown error';
    throw new Error(`Could not connect to ${url}: ${reason}`);
  }

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as ApiError;
      errorMessage = body.error;
    } catch {
      errorMessage = 'Unknown error';
    }
    throw new Error(`API request failed (${response.status}): ${errorMessage}`);
  }

  return (await response.json()) as BootstrapOnboardResponse;
}

export interface ProjectStatusResponse {
  project_id: string;
  slug: string;
  title: string;
  org_slug: string;
  status: 'awaiting_approval' | 'approved' | 'disabled';
  access_mode: 'public' | 'password';
  approved: boolean;
  published: boolean;
  active_publish_pointer: string | null;
  delivery_url: string | null;
  url: string | null;
  updated_at: string;
}

export async function getProjectStatus(
  apiBaseUrl: string,
  projectId: string,
): Promise<ProjectStatusResponse> {
  let response: Response;
  const url = `${apiBaseUrl.replace(/\/$/, '')}/status/${encodeURIComponent(projectId)}`;

  try {
    response = await fetch(url);
  } catch (_error: unknown) {
    const reason = _error instanceof Error ? _error.message : 'Unknown error';
    throw new Error(`Could not connect to ${url}: ${reason}`);
  }

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as ApiError;
      errorMessage = body.error;
    } catch {
      errorMessage = 'Unknown error';
    }
    throw new Error(`API request failed (${response.status}): ${errorMessage}`);
  }

  return (await response.json()) as ProjectStatusResponse;
}
