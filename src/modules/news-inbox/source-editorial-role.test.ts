import { describe, expect, it } from 'vitest';

import { classifySourceEditorialRole } from './source-editorial-role.js';

describe('classifySourceEditorialRole', () => {
  it('classifies an official-team source as OFFICIAL_TEAM regardless of contentType', () => {
    expect(
      classifySourceEditorialRole({
        slug: 'packers-news',
        isOfficialTeam: true,
        contentType: 'ARTICLE',
      }),
    ).toBe('OFFICIAL_TEAM');
    expect(
      classifySourceEditorialRole({
        slug: 'packers-videos',
        isOfficialTeam: true,
        contentType: 'VIDEO',
      }),
    ).toBe('OFFICIAL_TEAM');
  });

  it('classifies a non-official VIDEO/HIGHLIGHT source as VIDEO_FIRST', () => {
    expect(
      classifySourceEditorialRole({
        slug: 'some-video-feed',
        isOfficialTeam: false,
        contentType: 'VIDEO',
      }),
    ).toBe('VIDEO_FIRST');
    expect(
      classifySourceEditorialRole({
        slug: 'some-highlight-feed',
        isOfficialTeam: false,
        contentType: 'HIGHLIGHT',
      }),
    ).toBe('VIDEO_FIRST');
  });

  it('classifies a known independent national outlet as NATIONAL_REPORTING', () => {
    expect(
      classifySourceEditorialRole({
        slug: 'espn-nfl-news',
        isOfficialTeam: false,
        contentType: 'ARTICLE',
      }),
    ).toBe('NATIONAL_REPORTING');
    expect(
      classifySourceEditorialRole({
        slug: 'profootballtalk',
        isOfficialTeam: false,
        contentType: 'ARTICLE',
      }),
    ).toBe('NATIONAL_REPORTING');
    expect(
      classifySourceEditorialRole({
        slug: 'cbs-sports-nfl',
        isOfficialTeam: false,
        contentType: 'ARTICLE',
      }),
    ).toBe('NATIONAL_REPORTING');
  });

  it('falls back to OTHER for an unrecognized non-official ARTICLE source', () => {
    expect(
      classifySourceEditorialRole({
        slug: 'some-blog',
        isOfficialTeam: false,
        contentType: 'ARTICLE',
      }),
    ).toBe('OTHER');
  });
});
