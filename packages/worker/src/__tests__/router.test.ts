import { describe, it, expect } from 'vitest';
import { buildRoute, matchRoute, Router } from '../router.js';
import type { Env } from '../index.js';

describe('buildRoute', () => {
  it('creates a route with no params', () => {
    const handler = async () => new Response('ok');
    const route = buildRoute('GET', '/api/status', handler);
    expect(route.method).toBe('GET');
    expect(route.paramNames).toEqual([]);
    expect(route.pattern.test('/api/status')).toBe(true);
    expect(route.pattern.test('/api/other')).toBe(false);
  });

  it('creates a route with path params', () => {
    const handler = async () => new Response('ok');
    const route = buildRoute('GET', '/api/repos/:owner/:repo', handler);
    expect(route.paramNames).toEqual(['owner', 'repo']);
    expect(route.pattern.test('/api/repos/myorg/myrepo')).toBe(true);
    expect(route.pattern.test('/api/repos/myorg')).toBe(false);
    expect(route.pattern.test('/api/repos/myorg/myrepo/extra')).toBe(false);
  });

  it('does not match partial paths', () => {
    const handler = async () => new Response('ok');
    const route = buildRoute('GET', '/api/status', handler);
    expect(route.pattern.test('/api/status/extra')).toBe(false);
    expect(route.pattern.test('/prefix/api/status')).toBe(false);
  });
});

describe('matchRoute', () => {
  const handler = async () => new Response('ok');

  it('returns null when no routes match', () => {
    const routes = [buildRoute('GET', '/api/status', handler)];
    const result = matchRoute(routes, 'GET', '/api/other');
    expect(result).toBeNull();
  });

  it('returns null when method does not match', () => {
    const routes = [buildRoute('GET', '/api/status', handler)];
    const result = matchRoute(routes, 'POST', '/api/status');
    expect(result).toBeNull();
  });

  it('matches a simple route', () => {
    const routes = [buildRoute('GET', '/api/status', handler)];
    const result = matchRoute(routes, 'GET', '/api/status');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({});
  });

  it('extracts path parameters', () => {
    const routes = [buildRoute('GET', '/api/repos/:owner/:repo', handler)];
    const result = matchRoute(routes, 'GET', '/api/repos/myorg/myrepo');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ owner: 'myorg', repo: 'myrepo' });
  });

  it('decodes URI-encoded path parameters', () => {
    const routes = [buildRoute('GET', '/api/repos/:owner/:repo', handler)];
    const result = matchRoute(routes, 'GET', '/api/repos/my%20org/my%20repo');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ owner: 'my org', repo: 'my repo' });
  });

  it('matches the first matching route', () => {
    const handler1 = async () => new Response('first');
    const handler2 = async () => new Response('second');
    const routes = [
      buildRoute('GET', '/api/repos/:owner/:repo', handler1),
      buildRoute('GET', '/api/repos/:a/:b', handler2),
    ];
    const result = matchRoute(routes, 'GET', '/api/repos/x/y');
    expect(result).not.toBeNull();
    expect(result!.handler).toBe(handler1);
  });
});

describe('Router', () => {
  it('handles a matching request', async () => {
    const r = new Router();
    r.get('/api/status', async () => new Response('ok'));

    const request = new Request('http://localhost/api/status', { method: 'GET' });
    const env = {} as Env;
    const response = await r.handle(request, env);
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe('ok');
  });

  it('returns null for non-matching request', async () => {
    const r = new Router();
    r.get('/api/status', async () => new Response('ok'));

    const request = new Request('http://localhost/api/other', { method: 'GET' });
    const env = {} as Env;
    const response = await r.handle(request, env);
    expect(response).toBeNull();
  });

  it('supports all HTTP methods', async () => {
    const r = new Router();
    r.get('/get', async () => new Response('get'));
    r.post('/post', async () => new Response('post'));
    r.put('/put', async () => new Response('put'));
    r.delete('/del', async () => new Response('del'));

    const env = {} as Env;

    const getResp = await r.handle(new Request('http://localhost/get', { method: 'GET' }), env);
    expect(await getResp!.text()).toBe('get');

    const postResp = await r.handle(new Request('http://localhost/post', { method: 'POST' }), env);
    expect(await postResp!.text()).toBe('post');

    const putResp = await r.handle(new Request('http://localhost/put', { method: 'PUT' }), env);
    expect(await putResp!.text()).toBe('put');

    const delResp = await r.handle(new Request('http://localhost/del', { method: 'DELETE' }), env);
    expect(await delResp!.text()).toBe('del');
  });

  it('passes params to handler', async () => {
    const r = new Router();
    r.get('/api/repos/:owner/:repo', async (_req, _env, params) => {
      return new Response(JSON.stringify(params));
    });

    const request = new Request('http://localhost/api/repos/acme/docs', { method: 'GET' });
    const env = {} as Env;
    const response = await r.handle(request, env);
    const body = await response!.json() as Record<string, string>;
    expect(body).toEqual({ owner: 'acme', repo: 'docs' });
  });
});
