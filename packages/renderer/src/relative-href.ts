/**
 * Route-relative href algorithm (09-fixed-reader-and-serving).
 *
 * For a current page route and target public path, remove their longest common
 * directory prefix, emit one `../` for every remaining directory segment in the
 * current page route, then emit the remaining target segments. Page targets end
 * with `/`; file targets retain their filename. A target at the same directory
 * is `./`; a fragment may follow the computed reference.
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
    const segs = dirSegments(target);
    targetDir = segs;
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

/** Map a site page route to the archive object path. */
export function pageObjectPath(route: string): string {
  if (route === '/') return 'pages/index.html';
  const body = route.replace(/^\//, '').replace(/\/$/, '');
  return `pages/${body}/index.html`;
}

/** Map a public asset/attachment path to an archive object path under a prefix. */
export function mediaObjectPath(prefix: 'assets' | 'attachments', publicPath: string): string {
  const body = publicPath.replace(/^\//, '');
  return `${prefix}/${body}`;
}
