/**
 * Standard API response helpers.
 * All responses follow the { ok, data/error } envelope format.
 */

export function jsonSuccess<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } } = {
    ok: false,
    error: { code, message },
  };
  if (details) {
    body.error.details = details;
  }
  return Response.json(body, { status });
}
