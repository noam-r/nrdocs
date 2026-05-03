export interface ApiError {
  error: string;
}

/** Public status from GET /status/:id (no API key). */
export interface RepoStatusResponse {
  repo_id: string;
  slug: string;
  title: string;
  status: 'awaiting_approval' | 'approved' | 'disabled';
  access_mode: 'public' | 'password';
  repo_identity?: string | null;
  approved: boolean;
  published: boolean;
  active_publish_pointer: string | null;
  delivery_url: string | null;
  url: string | null;
  updated_at: string;
}

export async function getRepoStatus(
  apiBaseUrl: string,
  repoId: string,
): Promise<RepoStatusResponse> {
  let response: Response;
  const url = `${apiBaseUrl.replace(/\/$/, '')}/status/${encodeURIComponent(repoId)}`;

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

  return (await response.json()) as RepoStatusResponse;
}

export async function setRepoPasswordWithPublishToken(
  apiBaseUrl: string,
  repoId: string,
  repoPublishToken: string,
  password: string,
): Promise<void> {
  let response: Response;
  const url = `${apiBaseUrl.replace(/\/$/, '')}/repos/${encodeURIComponent(repoId)}/password`;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${repoPublishToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
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
}
