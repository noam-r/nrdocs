import { formatId, type InstanceId } from '@nrdocs/contracts';
import { parseResourceSuffix, resourceNamesFor } from '@nrdocs/contracts';

const SUFFIX_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Generate a 20-character lowercase Crockford base32 resource suffix. */
export function generateResourceSuffix(randomBytes: Uint8Array): string {
  if (randomBytes.byteLength < 13) throw new Error('need at least 13 random bytes');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of randomBytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 20) {
      out += SUFFIX_ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
    if (out.length >= 20) break;
  }
  while (out.length < 20) out += '0';
  const parsed = parseResourceSuffix(out.slice(0, 20));
  if (!parsed) throw new Error('failed to generate resource suffix');
  return parsed;
}

export function generateInstanceId(random16: Uint8Array): InstanceId {
  return formatId('inst', random16) as InstanceId;
}

export function plannedResourceNames(accountId: string, suffix: string) {
  return resourceNamesFor(accountId, suffix);
}
