/**
 * Route-relative href algorithm (09-fixed-reader-and-serving).
 * Duplicated in the Worker so publication validation does not depend on the renderer package.
 */
export function routeRelativeHref(currentRoute: string, targetPath: string): string {
  const hash = targetPath.indexOf('#');
  const fragment = hash >= 0 ? targetPath.slice(hash) : '';
  let target = hash >= 0 ? targetPath.slice(0, hash) : targetPath;
  if (target === '' && fragment) return fragment;

  const currentDir = dirSegments(currentRoute);
  const isPage = target.endsWith('/') || target === '';
  if (target === '') target = '/';

  let targetDir: string[];
  let leaf: string | null;
  if (isPage) {
    targetDir = dirSegments(target);
    leaf = null;
  } else {
    const segs = target.replace(/^\//, '').split('/').filter(Boolean);
    leaf = segs.pop() ?? '';
    targetDir = segs;
  }

  let common = 0;
  while (
    common < currentDir.length &&
    common < targetDir.length &&
    currentDir[common] === targetDir[common]
  ) {
    common++;
  }

  const ups = currentDir.length - common;
  const down = targetDir.slice(common);
  const pieces: string[] = [];
  for (let i = 0; i < ups; i++) pieces.push('..');
  pieces.push(...down);
  if (leaf !== null) pieces.push(leaf);

  let href: string;
  if (pieces.length === 0) {
    href = './';
  } else if (isPage) {
    href = `${pieces.join('/')}/`;
  } else {
    href = pieces.join('/');
  }

  return href + fragment;
}

function dirSegments(route: string): string[] {
  if (route === '/' || route === '') return [];
  return route.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
}
