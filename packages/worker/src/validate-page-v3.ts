import { validateStoredPage } from './validate-page.js';
import type { ManifestV1, ManifestV2, ManifestV3 } from '@nrdocs/contracts';

export function validateStoredPageV3(
  htmlBytes: Uint8Array,
  options: { pageRoute: string; manifest: ManifestV1 | ManifestV2 | ManifestV3 },
): void {
  validateStoredPage(htmlBytes, { ...options, pageSchema: 3 });
}
