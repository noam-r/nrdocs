const GRANT_PATH = /\/_nrdocs\/agent\/share\/([^/]+)/g;

export function redactAgentGrantPath(pathname: string): string {
  return pathname.replace(GRANT_PATH, '/_nrdocs/agent/share/[REDACTED_GRANT]');
}

export function redactLogText(text: string): string {
  return text.replace(GRANT_PATH, '/_nrdocs/agent/share/[REDACTED_GRANT]');
}
