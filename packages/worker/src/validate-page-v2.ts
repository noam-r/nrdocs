import { validateStoredPage } from './validate-page.js';
import type { ManifestV1, ManifestV2 } from '@nrdocs/contracts';

export function validateStoredPageV2(
  htmlBytes: Uint8Array,
  options: { pageRoute: string; manifest: ManifestV1 | ManifestV2 },
): void {
  validateStoredPage(htmlBytes, { ...options, pageSchema: 2 });
}
