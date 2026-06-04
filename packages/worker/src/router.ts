/**
 * Simple request router for Cloudflare Workers.
 * No external dependencies — pattern-based routing with path parameter extraction.
 */

import type { Env } from './index.js';

export type Handler = (
  request: Request,
  env: Env,
  params: Record<string, string>,
) => Promise<Response>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/**
 * Converts a path pattern like `/api/repos/:owner/:repo` into a RegExp
 * and extracts parameter names.
 */
export function buildRoute(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const pattern = new RegExp(`^${regexStr}$`);
  return { method, pattern, paramNames, handler };
}

/**
 * Matches a request against a list of routes.
 * Returns the handler and extracted params, or null if no match.
 */
export function matchRoute(
  routes: Route[],
  method: string,
  pathname: string,
): { handler: Handler; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        const name = route.paramNames[i]!;
        params[name] = decodeURIComponent(match[i + 1]!);
      }
      return { handler: route.handler, params };
    }
  }
  return null;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: Handler): void {
    this.routes.push(buildRoute('GET', path, handler));
  }

  post(path: string, handler: Handler): void {
    this.routes.push(buildRoute('POST', path, handler));
  }

  put(path: string, handler: Handler): void {
    this.routes.push(buildRoute('PUT', path, handler));
  }

  patch(path: string, handler: Handler): void {
    this.routes.push(buildRoute('PATCH', path, handler));
  }

  delete(path: string, handler: Handler): void {
    this.routes.push(buildRoute('DELETE', path, handler));
  }

  async handle(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    const result = matchRoute(this.routes, request.method, url.pathname);
    if (!result) return null;
    return result.handler(request, env, result.params);
  }
}
