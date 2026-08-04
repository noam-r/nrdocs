import { describe, expect, it } from 'vitest';
import {
  CONTRACTS_PACKAGE,
  contractsReady,
  parseNrdocsConfig,
  parsePublisherCredentialFile,
  parseInstanceDescriptor,
  parseSlug,
  normalizeTitle,
  resolveLanguage,
  parseDirection,
  DEFAULT_LANGUAGE,
  DEFAULT_DIRECTION,
  portablePathCollisionKey,
  findPathCollisions,
  canonicalizeJson,
  canonicalizeJsonBytes,
  assertExtensionSetsDisjoint,
  IMAGE_EXTENSIONS,
  ATTACHMENT_EXTENSIONS,
  EXTENSION_MEDIA_TYPES,
  mediaTypeForExtension,
  sealManifest,
  parseManifestV1,
  parseApiSuccessEnvelope,
  parseApiErrorEnvelope,
  parseProtocolVersionData,
  parsePublishTargetData,
  parsePublishResultData,
  exitCodeForApiErrorEnvelope,
  exitCodeForPublisherApiError,
  ExitCode,
  PublisherApiErrorCode,
  parseSiteId,
  formatId,
  fixtures,
} from './index.js';

describe('@nrdocs/contracts', () => {
  it('exports a stable package identity', () => {
    expect(CONTRACTS_PACKAGE).toBe('@nrdocs/contracts');
    expect(contractsReady()).toBe(true);
  });
});

describe('nrdocs.yml schema', () => {
  it('round-trips minimum preview and connected configs', () => {
    expect(parseNrdocsConfig(fixtures.previewConfigRaw)).toEqual(fixtures.previewConfigExpected);
    expect(parseNrdocsConfig(fixtures.connectedConfigRaw)).toEqual(
      fixtures.connectedConfigExpected,
    );
  });

  it('rejects unknown fields', () => {
    expect(() => parseNrdocsConfig({ ...fixtures.previewConfigRaw, theme: 'dark' })).toThrow(
      /unknown/,
    );
  });

  it('defaults omitted language and direction without host locale', () => {
    const cfg = parseNrdocsConfig({ title: 'T', navigation: 'auto' });
    expect(cfg.language).toBe(DEFAULT_LANGUAGE);
    expect(cfg.direction).toBe(DEFAULT_DIRECTION);
    expect(resolveLanguage(undefined)).toBe('und');
    expect(parseDirection(undefined)).toBe('auto');
  });

  it('requires credential when asked', () => {
    expect(() => parseNrdocsConfig(fixtures.previewConfigRaw, { requireCredential: true })).toThrow(
      /credential/,
    );
  });
});

describe('language and title', () => {
  it('canonicalizes language tags and rejects lists', () => {
    expect(resolveLanguage('EN-us')).toBe('en-US');
    expect(resolveLanguage('en,fr')).toBeNull();
    expect(resolveLanguage('!!!')).toBeNull();
  });

  it('normalizes titles and rejects empty, control, overlong', () => {
    expect(normalizeTitle('  Hello  ')).toBe('Hello');
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle('a\u0001b')).toBeNull();
    expect(normalizeTitle('x'.repeat(161))).toBeNull();
    expect(normalizeTitle('Same')).toBe('Same');
    expect(normalizeTitle('Same')).toBe('Same'); // duplicates allowed
  });
});

describe('slug and ids', () => {
  it('accepts valid slugs and rejects reserved/malformed', () => {
    for (const s of fixtures.idSlugPathCases.validSlugs) {
      expect(parseSlug(s)).toBe(s);
    }
    for (const s of fixtures.idSlugPathCases.invalidSlugs) {
      expect(parseSlug(s)).toBeNull();
    }
    expect(parseSlug(fixtures.idSlugPathCases.reservedSlug)).toBeNull();
  });

  it('parses and formats opaque IDs', () => {
    expect(parseSiteId(fixtures.FIXTURE_SITE_ID)).toBe(fixtures.FIXTURE_SITE_ID);
    const id = formatId('site', new Uint8Array(16).fill(7));
    expect(parseSiteId(id)).toBe(id);
  });
});

describe('path collision keys', () => {
  it('detects exact, NFC, Unicode-case, and cross-collection collisions', () => {
    const { exact, nfc, unicodeCase, crossCollection } = fixtures.idSlugPathCases.pathCollisions;
    expect(findPathCollisions(exact).length).toBeGreaterThan(0);
    expect(portablePathCollisionKey(nfc[0]!.path)).toBe(portablePathCollisionKey(nfc[1]!.path));
    expect(findPathCollisions(nfc).length).toBeGreaterThan(0);
    expect(findPathCollisions(unicodeCase).length).toBeGreaterThan(0);
    expect(findPathCollisions(crossCollection).length).toBeGreaterThan(0);
  });
});

describe('extensions and MIME', () => {
  it('maps every allowed extension exactly once and keeps sets disjoint', () => {
    assertExtensionSetsDisjoint();
    for (const ext of [...IMAGE_EXTENSIONS, ...ATTACHMENT_EXTENSIONS]) {
      expect(mediaTypeForExtension(ext)).toBe(EXTENSION_MEDIA_TYPES[ext]);
    }
  });
});

describe('canonical JSON and artifact digest', () => {
  it('matches golden bytes', () => {
    expect(canonicalizeJson(fixtures.canonicalJsonGolden.value)).toBe(
      fixtures.canonicalJsonGolden.expected,
    );
    const bytes = canonicalizeJsonBytes(fixtures.canonicalJsonGolden.value);
    expect(new TextDecoder().decode(bytes)).toBe(fixtures.canonicalJsonGolden.expected);
  });

  it('seals manifest digests stably', async () => {
    const a = await sealManifest(fixtures.validManifestDraft);
    const b = await sealManifest(fixtures.validManifestDraft);
    expect(a.artifact.digest).toBe(b.artifact.digest);
    expect(a.artifact.digest.startsWith('sha256:')).toBe(true);
    const parsed = await parseManifestV1(a);
    expect(parsed.artifact.digest).toBe(a.artifact.digest);
  });

  it('rejects unknown fields, bad counts, and collisions', async () => {
    const sealed = await sealManifest(fixtures.validManifestDraft);
    await expect(parseManifestV1({ ...sealed, extra: true })).rejects.toThrow(/unknown/);
    await expect(
      parseManifestV1({
        ...sealed,
        artifact: { ...sealed.artifact, file_count: 99 },
      }),
    ).rejects.toThrow(/file_count/);
    const colliding = {
      ...sealed,
      pages: [
        ...sealed.pages,
        {
          route: '/Getting-Started/',
          object: 'pages/other/index.html',
          title: 'Dup',
          size: 1,
          sha256: 'e'.repeat(64),
        },
      ],
      artifact: {
        ...sealed.artifact,
        file_count: 4,
        uncompressed_size: sealed.artifact.uncompressed_size + 1,
      },
    };
    await expect(parseManifestV1(colliding, { verifyArtifactDigest: false })).rejects.toThrow(
      /collision/,
    );
  });
});

describe('credentials and instance descriptors', () => {
  it('parses credential and instance fixtures', () => {
    expect(parsePublisherCredentialFile(fixtures.credentialFileRaw)).toEqual(
      fixtures.credentialFileRaw,
    );
    expect(parseInstanceDescriptor(fixtures.instanceDescriptorRaw)).toEqual(
      fixtures.instanceDescriptorExpected,
    );
  });
});

describe('publisher API envelopes and exit mapping', () => {
  it('round-trips success fixtures', () => {
    expect(parseApiSuccessEnvelope(fixtures.publishTargetSuccess, parsePublishTargetData)).toEqual(
      fixtures.publishTargetSuccess,
    );
    expect(
      parseApiSuccessEnvelope(fixtures.publishPublishedSuccess, parsePublishResultData),
    ).toEqual(fixtures.publishPublishedSuccess);
    expect(
      parseApiSuccessEnvelope(fixtures.publishUnchangedSuccess, parsePublishResultData),
    ).toEqual(fixtures.publishUnchangedSuccess);
    expect(parseProtocolVersionData(fixtures.protocolVersionData)).toEqual(
      fixtures.protocolVersionData,
    );
  });

  it('maps every API error fixture to exactly one exit category', () => {
    expect(fixtures.apiErrorFixtures.length).toBe(Object.keys(PublisherApiErrorCode).length);
    for (const err of fixtures.apiErrorFixtures) {
      const parsed = parseApiErrorEnvelope(err);
      const code = exitCodeForApiErrorEnvelope(parsed);
      expect([
        ExitCode.CredentialOrAuthority,
        ExitCode.RetryableExternal,
        ExitCode.LocalValidation,
        ExitCode.CompatibilityOrProtocol,
      ]).toContain(code);
      expect(exitCodeForPublisherApiError(err.error.code)).toBe(code);
    }
    expect(exitCodeForPublisherApiError(PublisherApiErrorCode.RateLimited)).toBe(
      ExitCode.RetryableExternal,
    );
  });
});

describe('site state fixtures', () => {
  it('includes public empty and password published states', () => {
    expect(fixtures.publicEmptySite.access_mode).toBe('public');
    expect(fixtures.publicEmptySite.current_publication).toBeNull();
    expect(fixtures.passwordPublishedSite.access_mode).toBe('password');
    expect(fixtures.passwordPublishedSite.current_publication).not.toBeNull();
  });
});
