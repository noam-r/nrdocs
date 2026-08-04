import hljs from 'highlight.js/lib/core';
import plaintext from 'highlight.js/lib/languages/plaintext';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import http from 'highlight.js/lib/languages/http';
import diff from 'highlight.js/lib/languages/diff';
import { escapeHtml } from './escape.js';

hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('ini', ini);
// Spec lists toml; highlight.js 11.11.1 has no dedicated toml grammar — use ini-compatible.
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('http', http);
hljs.registerLanguage('diff', diff);

const ALIASES: Record<string, string> = {
  shell: 'bash',
  sh: 'bash',
  js: 'javascript',
  ts: 'typescript',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  py: 'python',
};

const SUPPORTED = new Set([
  'plaintext',
  'bash',
  'javascript',
  'typescript',
  'json',
  'yaml',
  'markdown',
  'xml',
  'css',
  'sql',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'kotlin',
  'swift',
  'dockerfile',
  'ini',
  'toml',
  'http',
  'diff',
]);

export function normalizeHighlightLanguage(raw: string | null | undefined): string {
  if (!raw) return 'plaintext';
  const key = raw.trim().toLowerCase();
  const mapped = ALIASES[key] ?? key;
  return SUPPORTED.has(mapped) ? mapped : 'plaintext';
}

/** Deterministic highlight with no autodetection. Returns inner HTML for <code>. */
export function highlightCode(
  code: string,
  languageHint: string | null | undefined,
): { language: string; innerHtml: string } {
  const language = normalizeHighlightLanguage(languageHint);
  if (language === 'plaintext' || !hljs.getLanguage(language)) {
    return { language: 'plaintext', innerHtml: escapeHtml(code) };
  }
  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return { language, innerHtml: result.value };
  } catch {
    return { language: 'plaintext', innerHtml: escapeHtml(code) };
  }
}
