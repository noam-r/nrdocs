/**
 * GitHub Actions OIDC token request helper.
 */
export async function getOIDCToken(): Promise<string | null> {
  const requestUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'];
  const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
  if (!requestUrl || !requestToken) return null;

  try {
    const res = await fetch(`${requestUrl}&audience=nrdocs`, {
      headers: { Authorization: `bearer ${requestToken}` },
    });
    const json = (await res.json()) as { value?: string };
    return json.value ?? null;
  } catch {
    return null;
  }
}
