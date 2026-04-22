import { describe, it, expect } from 'vitest';
import {
  parseProjectConfig,
  parseNavConfig,
  parseAllowedListConfig,
  validateSlugMatch,
} from './config-parser.js';

describe('parseProjectConfig', () => {
  const validYaml = `
slug: my-project
title: "My Project Documentation"
description: "Internal docs for My Project"
publish_enabled: true
access_mode: password
`;

  it('parses a valid project.yml', () => {
    const config = parseProjectConfig(validYaml);
    expect(config).toEqual({
      slug: 'my-project',
      title: 'My Project Documentation',
      description: 'Internal docs for My Project',
      publish_enabled: true,
      access_mode: 'password',
    });
  });

  it('throws when required fields are missing', () => {
    expect(() => parseProjectConfig('slug: test\n')).toThrow('missing required fields');
  });

  it('throws for invalid access_mode', () => {
    const yaml = validYaml.replace('password', 'invite_list');
    expect(() => parseProjectConfig(yaml)).toThrow('access_mode must be one of');
  });

  it('throws for non-string slug', () => {
    const yaml = validYaml.replace('my-project', '123');
    // 123 is parsed as number by yaml
    expect(() => parseProjectConfig(yaml.replace('slug: 123', 'slug: 123'))).toThrow();
  });

  it('throws for empty content', () => {
    expect(() => parseProjectConfig('')).toThrow();
  });

  it('throws for non-boolean publish_enabled', () => {
    const yaml = validYaml.replace('publish_enabled: true', 'publish_enabled: "yes"');
    expect(() => parseProjectConfig(yaml)).toThrow('publish_enabled must be a boolean');
  });
});

describe('parseNavConfig', () => {
  const validYaml = `
nav:
  - label: "Getting Started"
    path: getting-started
  - label: "Guides"
    section: true
    children:
      - label: "Installation"
        path: guides/installation
      - label: "Configuration"
        path: guides/configuration
  - label: "API Reference"
    path: api-reference
`;

  it('parses a valid nav.yml', () => {
    const config = parseNavConfig(validYaml);
    expect(config.nav).toHaveLength(3);
    expect(config.nav[0]).toEqual({ label: 'Getting Started', path: 'getting-started' });
    expect(config.nav[1].label).toBe('Guides');
    expect(config.nav[1].section).toBe(true);
    expect(config.nav[1].children).toHaveLength(2);
  });

  it('throws when nav is missing', () => {
    expect(() => parseNavConfig('other: value\n')).toThrow('must contain a "nav" array');
  });

  it('throws when nav is empty', () => {
    expect(() => parseNavConfig('nav: []\n')).toThrow('must not be empty');
  });

  it('throws when nav item has no label', () => {
    const yaml = 'nav:\n  - path: test\n';
    expect(() => parseNavConfig(yaml)).toThrow('non-empty "label"');
  });

  it('throws when nav item has neither path nor section', () => {
    const yaml = 'nav:\n  - label: "Test"\n';
    expect(() => parseNavConfig(yaml)).toThrow('must have either "path" or "section: true"');
  });

  it('throws when nav item has both path and section', () => {
    const yaml = 'nav:\n  - label: "Test"\n    path: test\n    section: true\n    children:\n      - label: "Child"\n        path: child\n';
    expect(() => parseNavConfig(yaml)).toThrow('cannot have both "path" and "section: true"');
  });

  it('throws when section item has no children', () => {
    const yaml = 'nav:\n  - label: "Test"\n    section: true\n';
    expect(() => parseNavConfig(yaml)).toThrow('non-empty "children" array');
  });

  it('throws when section item has empty children', () => {
    const yaml = 'nav:\n  - label: "Test"\n    section: true\n    children: []\n';
    expect(() => parseNavConfig(yaml)).toThrow('non-empty "children" array');
  });
});

describe('parseAllowedListConfig', () => {
  it('parses a valid allowed-list.yml', () => {
    const yaml = 'allow:\n  - user@example.com\n  - "*@team.example.com"\n';
    const config = parseAllowedListConfig(yaml);
    expect(config.allow).toEqual(['user@example.com', '*@team.example.com']);
  });

  it('returns empty allow list for empty content', () => {
    const config = parseAllowedListConfig('');
    expect(config.allow).toEqual([]);
  });

  it('returns empty allow list when allow key is missing', () => {
    const config = parseAllowedListConfig('other: value\n');
    expect(config.allow).toEqual([]);
  });

  it('throws when allow is not an array', () => {
    expect(() => parseAllowedListConfig('allow: "not-an-array"\n')).toThrow('"allow" must be an array');
  });

  it('throws for non-string entries', () => {
    expect(() => parseAllowedListConfig('allow:\n  - 123\n')).toThrow('allow[0] must be a non-empty string');
  });
});

describe('validateSlugMatch', () => {
  const config = {
    slug: 'my-project',
    title: 'Test',
    description: 'Test',
    publish_enabled: true,
    access_mode: 'password' as const,
  };

  it('does not throw when slugs match', () => {
    expect(() => validateSlugMatch(config, 'my-project')).not.toThrow();
  });

  it('throws when slugs do not match', () => {
    expect(() => validateSlugMatch(config, 'other-project')).toThrow('Slug mismatch');
  });
});
