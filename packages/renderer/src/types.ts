import type { Direction, NavigationEntry } from '@nrdocs/contracts';

export const MAX_PUBLISHED_PAGES = 500;
export const MAX_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_NAV_DEPTH = 8;

export type SiteRoute = string;

export type PublicationDiagnostic = {
  code: string;
  message: string;
  sourceFile?: string;
  line?: number;
  column?: number;
};

export type PublicationNavNode = {
  kind: 'page' | 'section-heading';
  title: string;
  depth: number;
  sourceFile?: string;
  route?: SiteRoute;
  children: PublicationNavNode[];
};

export type PublicationPage = {
  sourceFile: string;
  route: SiteRoute;
  title: string;
  markdownText: string;
};

export type PublicationAsset = {
  sourceFile: string;
  publicPath: string;
  mediaType: string;
  referencedFrom: string[];
};

export type PublicationAttachment = {
  sourceFile: string;
  publicPath: string;
  mediaType: string;
  filename: string;
  referencedFrom: string[];
};

export type PublicationRoot = { kind: 'page'; route: '/' } | { kind: 'redirect'; route: SiteRoute };

export type NormalizedPublicationGraph = {
  rootDir: string;
  site: {
    title: string;
    language: string;
    direction: Direction;
  };
  navigationMode: 'auto' | 'explicit';
  explicitNavigation: NavigationEntry[];
  navTree: PublicationNavNode[];
  pages: PublicationPage[];
  root: PublicationRoot;
  assets: PublicationAsset[];
  attachments: PublicationAttachment[];
};

export class RendererError extends Error {
  readonly code: string;
  readonly sourceFile?: string;
  readonly line?: number;
  readonly column?: number;

  constructor(
    code: string,
    message: string,
    loc?: { sourceFile?: string; line?: number; column?: number },
  ) {
    super(message);
    this.name = 'RendererError';
    this.code = code;
    if (loc?.sourceFile !== undefined) this.sourceFile = loc.sourceFile;
    if (loc?.line !== undefined) this.line = loc.line;
    if (loc?.column !== undefined) this.column = loc.column;
  }
}

export function errorLoc(
  sourceFile: string,
  line?: number,
  column?: number,
): { sourceFile: string; line?: number; column?: number } {
  return {
    sourceFile,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}
