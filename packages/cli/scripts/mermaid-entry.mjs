/**
 * Browser entry: assign the Mermaid API to globalThis.mermaid (no ESM default interop).
 */
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false });

const global = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined;
if (global) {
  global.mermaid = mermaid;
}
