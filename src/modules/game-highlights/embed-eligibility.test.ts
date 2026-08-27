import { describe, expect, it } from 'vitest';

import { evaluateEmbedEligibility, isAllowedEmbedHost } from './embed-eligibility.js';

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com'];

describe('evaluateEmbedEligibility', () => {
  it('is UNKNOWN/no-embed when there is no embed URL at all', () => {
    expect(
      evaluateEmbedEligibility({ embedUrl: null, geoState: null, allowedHosts: null }),
    ).toEqual({ embedStatus: 'UNKNOWN', canEmbed: false });
  });

  it('is NOT_ALLOWED when the embed host is outside an explicit allowlist', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://vimeo.com/embed/1',
        geoState: { embeddable: true, allowedCountries: [], blockedCountries: [] },
        allowedHosts: YOUTUBE_HOSTS,
      }),
    ).toEqual({ embedStatus: 'NOT_ALLOWED', canEmbed: false });
  });

  it('passes an allowlisted host through to the geo check', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: true, allowedCountries: [], blockedCountries: [] },
        allowedHosts: YOUTUBE_HOSTS,
      }),
    ).toEqual({ embedStatus: 'ALLOWED', canEmbed: true });
  });

  it('is UNKNOWN/no-embed when there is no geo result (never checked or lookup failed)', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: null,
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'UNKNOWN', canEmbed: false });
  });

  it('is NOT_ALLOWED when the provider reports embeddable: false', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: false, allowedCountries: [], blockedCountries: [] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'NOT_ALLOWED', canEmbed: false });
  });

  it('is UNKNOWN/no-embed when embeddable is null (unrecognized restriction state)', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: null, allowedCountries: [], blockedCountries: [] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'UNKNOWN', canEmbed: false });
  });

  it('is ALLOWED when embeddable is true with empty allow/block lists', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: true, allowedCountries: [], blockedCountries: [] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'ALLOWED', canEmbed: true });
  });

  it('is GEO_RESTRICTED, not ALLOWED, when embeddable but scoped to an allowed-country list', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: true, allowedCountries: ['US', 'CA'], blockedCountries: [] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'GEO_RESTRICTED', canEmbed: false });
  });

  it('is GEO_RESTRICTED, not ALLOWED, when embeddable but scoped to a blocked-country list', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://www.youtube.com/embed/1',
        geoState: { embeddable: true, allowedCountries: [], blockedCountries: ['CN'] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'GEO_RESTRICTED', canEmbed: false });
  });

  it('treats null allowedHosts as "no allowlist enforced"', () => {
    expect(
      evaluateEmbedEligibility({
        embedUrl: 'https://any-provider.example/embed/1',
        geoState: { embeddable: true, allowedCountries: [], blockedCountries: [] },
        allowedHosts: null,
      }),
    ).toEqual({ embedStatus: 'ALLOWED', canEmbed: true });
  });
});

describe('isAllowedEmbedHost', () => {
  it('matches hostnames case-insensitively', () => {
    expect(isAllowedEmbedHost('https://WWW.YOUTUBE.COM/embed/1', YOUTUBE_HOSTS)).toBe(true);
  });

  it('rejects a host not present in the list', () => {
    expect(isAllowedEmbedHost('https://vimeo.com/embed/1', YOUTUBE_HOSTS)).toBe(false);
  });

  it('is false for an unparsable URL rather than throwing', () => {
    expect(isAllowedEmbedHost('not a url', YOUTUBE_HOSTS)).toBe(false);
  });
});
