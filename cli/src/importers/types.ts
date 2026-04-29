export interface ImportContext {
  cwd: string;
}

export interface ImportDetection {
  confidence: 'none' | 'possible' | 'matched';
  reason?: string;
}

export interface ImportResult {
  generatedFiles: string[];
  warnings: string[];
  nextSteps: string[];
}

export interface Importer {
  name: string;
  displayName: string;
  summary: string;
  detect(context: ImportContext): Promise<ImportDetection>;
  run(context: ImportContext, args: string[]): Promise<ImportResult>;
  printHelp(): void;
}
