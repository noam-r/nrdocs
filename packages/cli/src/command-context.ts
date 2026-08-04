import type { Runtime } from './runtime.js';
import type { Terminal } from './terminal.js';

export type CommandContext = {
  runtime: Runtime;
  terminal: Terminal;
  json: boolean;
  instance?: string;
  help: boolean;
};
