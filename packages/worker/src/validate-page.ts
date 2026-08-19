import { parseHTML } from 'linkedom';
import type { ManifestV1, ManifestV2 } from '@nrdocs/contracts';
import { ApiError } from './http.js';
import { PublisherApiErrorCode } from '@nrdocs/contracts';
import { LIMITS, PLATFORM_ASSETS, PLATFORM_ASSETS_V2 } from './limits.js';
import { routeRelativeHref } from './relative-href.js';

const ALLOWED_TAGS = new Set([
  'html',
  'head',
  'meta',
  'title',
  'link',
  'script',
  'body',
  'a',
  'div',
  'header',
  'button',
  'aside',
  'nav',
  'ul',
  'ol',
  'li',
  'main',
  'article',
  'section',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'pre',
  'code',
  'strong',
  'em',
  'del',
  'hr',
  'br',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'input',
  'span',
]);

const HEADING_ID_RE = /^nr-h-[0-9a-f]{16}$/;
const ALIGN_CLASS = new Set(['nr-align-left', 'nr-align-center', 'nr-align-right']);
const LANGUAGE_CLASS_RE = /^language-[a-z0-9+-]+$/;
const HLJS_CLASS_RE = /^hljs(-[a-z0-9-]+)?$/;
const NAV_SECTION_CLASS = 'nr-nav-section';

const SHELL_SKIP = { tag: 'A', className: 'nr-skip', href: '#nr-content' } as const;

function fail(message: string): never {
  throw new ApiError(PublisherApiErrorCode.InvalidArtifact, message);
}

function attrMap(el: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of Array.from(el.attributes)) {
    out.set(attr.name, attr.value);
  }
  return out;
}

function requireAttrs(el: Element, allowed: Set<string>): Map<string, string> {
  const attrs = attrMap(el);
  for (const name of attrs.keys()) {
    if (!allowed.has(name))
      fail(`Disallowed attribute "${name}" on <${el.tagName.toLowerCase()}>.`);
  }
  return attrs;
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function isFragmentOnly(href: string): boolean {
  return href.startsWith('#') && !href.startsWith('#/');
}

function validateInternalHref(
  href: string,
  pageRoute: string,
  allowedTargets: ReadonlySet<string>,
): void {
  if (href.includes('//') || href.includes('\\') || href.includes('\0')) {
    fail('Unsafe internal URL.');
  }
  if (href.includes('://') || href.startsWith('//')) {
    fail('Unsafe internal URL scheme.');
  }
  // mailto/http handled elsewhere; bare schemes with colon (except relative) rejected
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    fail('Unsafe internal URL scheme.');
  }
  let matched = false;
  for (const target of allowedTargets) {
    if (routeRelativeHref(pageRoute, target) === href) {
      matched = true;
      break;
    }
  }
  if (!matched && href !== '#nr-content') {
    fail('Internal URL does not resolve to a declared target.');
  }
}

function validateHref(
  href: string,
  pageRoute: string,
  allowedTargets: ReadonlySet<string>,
  opts: { allowExternal: boolean },
): void {
  if (!href) fail('Empty href.');
  if (isFragmentOnly(href)) return;
  if (opts.allowExternal && isExternalHref(href)) {
    try {
      // mailto and http(s) only
      if (/^mailto:/i.test(href)) return;
      const u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') fail('Unsupported URL scheme.');
      if (u.username || u.password) fail('URL must not contain userinfo.');
      return;
    } catch {
      fail('Malformed absolute URL.');
    }
  }
  validateInternalHref(href, pageRoute, allowedTargets);
}

function validateImgSrc(src: string, pageRoute: string, assetTargets: ReadonlySet<string>): void {
  if (!src || src.startsWith('/') || src.includes(':') || src.startsWith('data:')) {
    fail('Image src must be a local artifact-relative asset.');
  }
  let matched = false;
  for (const target of assetTargets) {
    if (routeRelativeHref(pageRoute, target) === src) {
      matched = true;
      break;
    }
  }
  if (!matched) fail('Image src does not resolve to a declared asset.');
}

function contentClassesOk(
  classes: string[],
  kind: 'generic' | 'pre' | 'code' | 'span' | 'align',
): boolean {
  for (const c of classes) {
    if (kind === 'align' && ALIGN_CLASS.has(c)) continue;
    if (c === 'nr-mermaid') continue;
    if (c === 'nr-broken-link') continue;
    if (LANGUAGE_CLASS_RE.test(c)) continue;
    if (HLJS_CLASS_RE.test(c)) continue;
    if (c === NAV_SECTION_CLASS) continue;
    if (c.startsWith('nr-')) {
      // only specific nr-* content classes above
      if (c === 'nr-mermaid') continue;
      return false;
    }
    return false;
  }
  return true;
}

function walkContent(
  node: Node,
  ctx: {
    pageRoute: string;
    pageTargets: ReadonlySet<string>;
    assetTargets: ReadonlySet<string>;
    mermaidCount: { n: number };
  },
): void {
  if (node.nodeType === 8 /* COMMENT */) fail('HTML comments are not allowed.');
  if (node.nodeType === 3 /* TEXT */) {
    const text = node.textContent ?? '';
    if (text.includes('\0')) fail('Text contains NUL.');
    return;
  }
  if (node.nodeType !== 1 /* ELEMENT */) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) fail(`Disallowed element <${tag}>.`);
  // Shell-only tags must never appear in article content.
  if (
    tag === 'html' ||
    tag === 'head' ||
    tag === 'body' ||
    tag === 'meta' ||
    tag === 'title' ||
    tag === 'link' ||
    tag === 'script' ||
    tag === 'header' ||
    tag === 'aside' ||
    tag === 'main' ||
    tag === 'footer' ||
    tag === 'button'
  ) {
    fail(`Disallowed element <${tag}> in article content.`);
  }

  // Shell region is validated separately; content walk starts at article children.
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const attrs = requireAttrs(el, new Set(['id']));
      const id = attrs.get('id');
      if (!id || !HEADING_ID_RE.test(id)) fail('Heading id must match nr-h-<16 hex>.');
      break;
    }
    case 'a': {
      const attrs = requireAttrs(el, new Set(['href', 'title', 'aria-current', 'class']));
      const href = attrs.get('href');
      if (!href) fail('Anchor requires href.');
      const cls = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
      for (const c of cls) {
        if (c !== 'nr-prev' && c !== 'nr-next') fail('Disallowed anchor class.');
      }
      if (attrs.has('aria-current') && attrs.get('aria-current') !== 'page') {
        fail('Invalid aria-current.');
      }
      validateHref(href, ctx.pageRoute, new Set([...ctx.pageTargets, ...ctx.assetTargets]), {
        allowExternal: true,
      });
      break;
    }
    case 'img': {
      const attrs = requireAttrs(el, new Set(['src', 'alt', 'title', 'loading', 'decoding']));
      if (!attrs.has('alt')) fail('img requires alt.');
      if (attrs.get('loading') !== 'lazy' || attrs.get('decoding') !== 'async') {
        fail('img requires loading=lazy and decoding=async.');
      }
      validateImgSrc(attrs.get('src')!, ctx.pageRoute, ctx.assetTargets);
      break;
    }
    case 'ol': {
      const attrs = requireAttrs(el, new Set(['start']));
      if (attrs.has('start')) {
        const n = Number(attrs.get('start'));
        if (!Number.isInteger(n) || n < -100000 || n > 100000) fail('Invalid ol start.');
      }
      break;
    }
    case 'th':
    case 'td': {
      const attrs = requireAttrs(el, new Set(['class']));
      const cls = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
      if (!contentClassesOk(cls, 'align')) fail('Invalid table cell class.');
      break;
    }
    case 'input': {
      const attrs = requireAttrs(el, new Set(['type', 'disabled', 'checked']));
      if (attrs.get('type') !== 'checkbox') fail('Only checkbox inputs are allowed.');
      if (!attrs.has('disabled')) fail('Task checkbox must be disabled.');
      break;
    }
    case 'pre': {
      const attrs = requireAttrs(el, new Set(['class', 'data-nr-mermaid']));
      const cls = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
      if (!contentClassesOk(cls, 'pre')) fail('Invalid pre class.');
      if (attrs.has('data-nr-mermaid')) {
        if (attrs.get('data-nr-mermaid') !== '') fail('data-nr-mermaid must be empty or boolean.');
        ctx.mermaidCount.n += 1;
        if (ctx.mermaidCount.n > LIMITS.maxMermaidBlocksPerPage) {
          fail('Too many Mermaid blocks on one page.');
        }
        const code = el.querySelector('code');
        const src = code?.textContent ?? '';
        if (new TextEncoder().encode(src).byteLength > LIMITS.maxMermaidSourceBytes) {
          fail('Mermaid source exceeds size limit.');
        }
      }
      break;
    }
    case 'code':
    case 'span': {
      const attrs = requireAttrs(el, new Set(tag === 'span' ? ['class', 'title'] : ['class']));
      const cls = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
      if (tag === 'span' && cls.includes('nr-broken-link')) {
        if (cls.length !== 1) fail('Invalid span class.');
        break;
      }
      if (attrs.has('title')) fail('title is only allowed on broken links.');
      if (!contentClassesOk(cls, tag === 'code' ? 'code' : 'span')) fail(`Invalid ${tag} class.`);
      break;
    }
    case 'li': {
      requireAttrs(el, new Set());
      break;
    }
    case 'ul': {
      requireAttrs(el, new Set());
      break;
    }
    case 'nav':
      fail('Unexpected nav in article content.');
      break;
    case 'div':
    case 'section':
    case 'p':
    case 'blockquote':
    case 'strong':
    case 'em':
    case 'del':
    case 'hr':
    case 'br':
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tr': {
      requireAttrs(el, new Set());
      break;
    }
    default: {
      requireAttrs(el, new Set());
      break;
    }
  }

  for (const child of Array.from(el.childNodes)) {
    walkContent(child, ctx);
  }
}

function walkNav(node: Node, pageRoute: string, pageTargets: ReadonlySet<string>): void {
  if (node.nodeType === 8) fail('HTML comments are not allowed.');
  if (node.nodeType === 3) return;
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'ul') {
    const attrs = requireAttrs(el, new Set(['class']));
    if (attrs.get('class') !== 'nr-nav-list') fail('Nav list class must be nr-nav-list.');
  } else if (tag === 'li') {
    const attrs = requireAttrs(el, new Set(['class']));
    if (attrs.get('class') !== 'nr-nav-item') fail('Nav item class must be nr-nav-item.');
  } else if (tag === 'a') {
    const attrs = requireAttrs(el, new Set(['href', 'aria-current']));
    const href = attrs.get('href');
    if (!href) fail('Nav link requires href.');
    if (attrs.has('aria-current') && attrs.get('aria-current') !== 'page') {
      fail('Invalid aria-current.');
    }
    validateHref(href, pageRoute, pageTargets, { allowExternal: false });
  } else if (tag === 'span') {
    const attrs = requireAttrs(el, new Set(['class']));
    if (attrs.get('class') !== NAV_SECTION_CLASS) fail('Invalid nav section class.');
  } else {
    fail(`Disallowed nav element <${tag}>.`);
  }
  for (const child of Array.from(el.childNodes)) walkNav(child, pageRoute, pageTargets);
}

function validateNavToggle(el: Element): void {
  if (
    el.tagName !== 'BUTTON' ||
    el.getAttribute('class') !== 'nr-nav-toggle' ||
    el.getAttribute('type') !== 'button' ||
    el.getAttribute('aria-controls') !== 'nr-nav' ||
    el.getAttribute('aria-expanded') !== 'false'
  ) {
    fail('Nav toggle button is invalid.');
  }
  requireAttrs(el, new Set(['class', 'type', 'aria-controls', 'aria-expanded']));
}

function validateSiteTitle(el: Element, pageRoute: string, pageTargets: ReadonlySet<string>): void {
  if (
    el.tagName !== 'A' ||
    el.getAttribute('class') !== 'nr-site-title' ||
    !el.getAttribute('href')
  ) {
    fail('Site title link is invalid.');
  }
  requireAttrs(el, new Set(['class', 'href']));
  validateHref(el.getAttribute('href')!, pageRoute, pageTargets, { allowExternal: false });
}

function validateThemeToggle(el: Element): void {
  if (
    el.tagName !== 'BUTTON' ||
    el.getAttribute('class') !== 'nr-theme-toggle' ||
    el.getAttribute('type') !== 'button' ||
    el.getAttribute('aria-label') !== 'Change color theme'
  ) {
    fail('Theme toggle button is invalid.');
  }
  requireAttrs(el, new Set(['class', 'type', 'aria-label']));
}

/**
 * Validate one complete fixed-shell HTML page against the Phase 9 page schema.
 */
export function validateStoredPage(
  htmlBytes: Uint8Array,
  options: {
    pageRoute: string;
    manifest: ManifestV1 | ManifestV2;
    pageSchema?: 1 | 2;
  },
): void {
  if (htmlBytes.byteLength > LIMITS.maxPageHtmlBytes) {
    fail('Page HTML exceeds size limit.');
  }
  if (htmlBytes.includes(0)) fail('Page HTML contains NUL.');
  const html = new TextDecoder('utf-8', { fatal: true }).decode(htmlBytes);
  if (!html.startsWith('<!doctype html>\n') && !html.startsWith('<!DOCTYPE html>\n')) {
    // Renderer emits lowercase doctype
    if (!/^<!doctype html>\n/i.test(html)) fail('Page must begin with HTML5 doctype.');
  }

  const { document } = parseHTML(html);
  const docEl = document.documentElement;
  if (!docEl || docEl.tagName !== 'HTML') fail('Missing html root.');

  const htmlAttrs = requireAttrs(docEl, new Set(['lang', 'dir']));
  if (htmlAttrs.get('lang') !== options.manifest.site.language) {
    fail('html lang must equal manifest site.language.');
  }
  if (htmlAttrs.get('dir') !== options.manifest.site.direction) {
    fail('html dir must equal manifest site.direction.');
  }

  const head = docEl.querySelector(':scope > head');
  const body = docEl.querySelector(':scope > body');
  if (!head || !body) fail('Document requires head and body.');

  // Head children: meta charset, meta viewport, title, icon, link css, script module — exact order
  const headChildren = Array.from(head.children);
  if (headChildren.length !== 6) fail('Head must contain exactly six elements.');
  const [metaCharset, metaViewport, titleEl, linkIcon, linkCss, scriptJs] =
    headChildren as Element[];
  if (metaCharset!.tagName !== 'META' || metaCharset!.getAttribute('charset') !== 'utf-8') {
    fail('First head element must be meta charset=utf-8.');
  }
  requireAttrs(metaCharset!, new Set(['charset']));
  if (
    metaViewport!.tagName !== 'META' ||
    metaViewport!.getAttribute('name') !== 'viewport' ||
    metaViewport!.getAttribute('content') !== 'width=device-width,initial-scale=1'
  ) {
    fail('Second head element must be viewport meta.');
  }
  requireAttrs(metaViewport!, new Set(['name', 'content']));
  if (titleEl!.tagName !== 'TITLE') fail('Third head element must be title.');
  requireAttrs(titleEl!, new Set());
  const assets = options.pageSchema === 2 ? PLATFORM_ASSETS_V2 : PLATFORM_ASSETS;
  if (
    linkIcon!.tagName !== 'LINK' ||
    linkIcon!.getAttribute('rel') !== 'icon' ||
    linkIcon!.getAttribute('href') !== assets[3] ||
    linkIcon!.getAttribute('type') !== 'image/svg+xml'
  ) {
    fail('Icon must be the fixed platform logo.svg.');
  }
  requireAttrs(linkIcon!, new Set(['rel', 'href', 'type']));
  if (
    linkCss!.tagName !== 'LINK' ||
    linkCss!.getAttribute('rel') !== 'stylesheet' ||
    linkCss!.getAttribute('href') !== assets[0]
  ) {
    fail('Stylesheet must be the fixed platform reader.css.');
  }
  requireAttrs(linkCss!, new Set(['rel', 'href']));
  if (
    scriptJs!.tagName !== 'SCRIPT' ||
    scriptJs!.getAttribute('type') !== 'module' ||
    scriptJs!.getAttribute('src') !== assets[1]
  ) {
    fail('Script must be the fixed platform reader.js module.');
  }
  requireAttrs(scriptJs!, new Set(['type', 'src']));

  const pageTargets = new Set(options.manifest.pages.map((p) => p.route));
  // Site root is always a valid internal target
  pageTargets.add('/');
  const assetTargets = new Set([
    ...options.manifest.assets.map((a) => a.path),
    ...options.manifest.attachments.map((a) => a.path),
  ]);

  const bodyChildren = Array.from(body.children);
  if (bodyChildren.length !== 4) fail('Body shell structure is invalid.');
  const [skip, header, layout, footer] = bodyChildren as Element[];

  if (
    skip!.tagName !== SHELL_SKIP.tag ||
    skip!.getAttribute('class') !== SHELL_SKIP.className ||
    skip!.getAttribute('href') !== SHELL_SKIP.href
  ) {
    fail('Skip link is invalid.');
  }
  requireAttrs(skip!, new Set(['class', 'href']));

  if (header!.tagName !== 'HEADER' || header!.getAttribute('class') !== 'nr-header') {
    fail('Header shell is invalid.');
  }
  requireAttrs(header!, new Set(['class']));
  const headerChildren = Array.from(header!.children);
  if (options.pageSchema === 2) {
    if (headerChildren.length !== 4) fail('Header must contain four controls.');
    const [navToggle, siteTitle, shareBtn, themeToggle] = headerChildren as Element[];
    validateNavToggle(navToggle!);
    validateSiteTitle(siteTitle!, options.pageRoute, pageTargets);
    if (
      shareBtn!.tagName !== 'BUTTON' ||
      shareBtn!.getAttribute('class') !== 'nr-ai-share nr-icon-btn' ||
      shareBtn!.getAttribute('type') !== 'button' ||
      shareBtn!.getAttribute('aria-label') !== 'Copy a prompt for an AI' ||
      shareBtn!.getAttribute('title') !== 'Copy a prompt for an AI' ||
      (shareBtn!.textContent ?? '').trim() !== 'Copy a prompt for an AI'
    ) {
      fail('Copy a prompt for an AI button is invalid.');
    }
    requireAttrs(shareBtn!, new Set(['class', 'type', 'aria-label', 'title']));
    validateThemeToggle(themeToggle!);
  } else {
    if (headerChildren.length !== 3) fail('Header must contain three controls.');
    const [navToggle, siteTitle, themeToggle] = headerChildren as Element[];
    validateNavToggle(navToggle!);
    validateSiteTitle(siteTitle!, options.pageRoute, pageTargets);
    validateThemeToggle(themeToggle!);
  }

  if (layout!.tagName !== 'DIV' || layout!.getAttribute('class') !== 'nr-layout') {
    fail('Layout shell is invalid.');
  }
  requireAttrs(layout!, new Set(['class']));
  const layoutChildren = Array.from(layout!.children);
  if (layoutChildren.length !== 2) fail('Layout must contain sidebar and main.');
  const [aside, main] = layoutChildren as Element[];
  if (
    aside!.tagName !== 'ASIDE' ||
    aside!.getAttribute('class') !== 'nr-sidebar' ||
    aside!.getAttribute('id') !== 'nr-nav'
  ) {
    fail('Sidebar shell is invalid.');
  }
  requireAttrs(aside!, new Set(['class', 'id']));
  const nav = aside!.querySelector(':scope > nav.nr-nav');
  if (!nav || nav.getAttribute('aria-label') !== 'Documentation')
    fail('Documentation nav is invalid.');
  requireAttrs(nav, new Set(['class', 'aria-label']));
  for (const child of Array.from(nav.childNodes)) {
    walkNav(child, options.pageRoute, pageTargets);
  }

  if (
    main!.tagName !== 'MAIN' ||
    main!.getAttribute('class') !== 'nr-main' ||
    main!.getAttribute('id') !== 'nr-content' ||
    main!.getAttribute('tabindex') !== '-1'
  ) {
    fail('Main shell is invalid.');
  }
  requireAttrs(main!, new Set(['class', 'id', 'tabindex']));
  const article = main!.querySelector(':scope > article.nr-article');
  if (!article) fail('Article shell is missing.');
  requireAttrs(article, new Set(['class']));

  const mermaidCount = { n: 0 };
  const articleChildren = Array.from(article.childNodes);
  for (const child of articleChildren) {
    if (child.nodeType === 1 && (child as Element).tagName === 'NAV') {
      const pagination = child as Element;
      if (
        pagination.getAttribute('class') !== 'nr-pagination' ||
        pagination.getAttribute('aria-label') !== 'Page navigation'
      ) {
        fail('Pagination nav is invalid.');
      }
      requireAttrs(pagination, new Set(['class', 'aria-label']));
      for (const link of Array.from(pagination.children)) {
        if (link.tagName !== 'A') fail('Pagination may contain only anchors.');
        const attrs = requireAttrs(link, new Set(['class', 'href']));
        const cls = attrs.get('class');
        if (cls !== 'nr-prev' && cls !== 'nr-next') fail('Invalid pagination class.');
        validateHref(attrs.get('href')!, options.pageRoute, pageTargets, { allowExternal: false });
      }
      continue;
    }
    walkContent(child, {
      pageRoute: options.pageRoute,
      pageTargets,
      assetTargets,
      mermaidCount,
    });
  }

  if (
    footer!.tagName !== 'FOOTER' ||
    footer!.getAttribute('class') !== 'nr-footer' ||
    (footer!.textContent ?? '').trim() !== 'Published with nrdocs'
  ) {
    fail('Footer shell is invalid.');
  }
  requireAttrs(footer!, new Set(['class']));
}
