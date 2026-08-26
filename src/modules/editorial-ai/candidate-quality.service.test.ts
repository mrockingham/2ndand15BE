import { describe, expect, it, vi } from 'vitest';

import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type {
  CandidateQualityRepository,
  QualityCandidate,
} from './candidate-quality.repository.js';
import {
  CandidateQualityService,
  classifySufficiency,
  deterministicRelevance,
} from './candidate-quality.service.js';

const actor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'editor@example.com',
  role: 'EDITOR',
};

function candidate(overrides: Partial<QualityCandidate> = {}): QualityCandidate {
  return {
    id: '00000000-0000-4000-8000-000000000100',
    sourceId: '00000000-0000-4000-8000-000000000200',
    sourceNameSnapshot: 'Example Sports',
    canonicalUrl: 'https://example.com/nfl/story',
    canonicalUrlHash: 'hash-1',
    sourceExternalId: 'story-1',
    headline: 'Arizona Cardinals prepare for preseason opener',
    sourceDescription: null,
    sourceAuthor: 'Reporter',
    sourcePublishedAt: new Date('2026-08-09T12:00:00Z'),
    discoveredAt: new Date('2026-08-09T12:01:00Z'),
    status: 'NEW',
    convertedArticleId: null,
    source: {
      kind: 'RSS',
      status: 'ACTIVE',
      isOfficialLeague: false,
      isOfficialTeam: false,
      allowsDescriptionUse: false,
      reliabilityWeight: 50,
      metadataRichnessWeight: 50,
      teamSpecificityWeight: 50,
      editorialUsefulnessWeight: 50,
      rightsProfile: {
        textUsage: 'UNKNOWN',
        imageUsage: 'UNKNOWN',
        videoUsage: 'UNKNOWN',
        quotationPolicy: 'UNKNOWN',
        reviewRequired: true,
      },
    },
    suggestedTeams: [
      {
        team: {
          id: '00000000-0000-4000-8000-000000000300',
          abbreviation: 'ARI',
          fullName: 'Arizona Cardinals',
          city: 'Arizona',
          name: 'Cardinals',
        },
      },
    ],
    qualityEvaluation: null,
    ...overrides,
  };
}

function repository(value: QualityCandidate, duplicate: 'UNIQUE' | 'DUPLICATE' = 'UNIQUE') {
  return {
    findCandidate: vi.fn().mockResolvedValue(value),
    listCandidateIds: vi.fn().mockResolvedValue([value.id]),
    findDuplicate: vi.fn().mockResolvedValue({
      status: duplicate,
      score: duplicate === 'DUPLICATE' ? 1 : null,
      closestCandidateId: duplicate === 'DUPLICATE' ? 'other' : null,
      closestArticleId: null,
    }),
    saveEvaluation: vi.fn().mockResolvedValue(undefined),
  } satisfies CandidateQualityRepository;
}

describe('deterministic candidate relevance', () => {
  it.each([
    ['NFL team story', candidate(), 'NFL'],
    [
      'NFL player story',
      candidate({ headline: 'Veteran quarterback returns to practice', suggestedTeams: [] }),
      'NFL',
    ],
    [
      'NFL league story',
      candidate({ headline: 'NFL announces preseason policy', suggestedTeams: [] }),
      'NFL',
    ],
    [
      'NFL-connected draft story',
      candidate({
        canonicalUrl: 'https://example.com/draft',
        headline: 'NFL Draft prospect completes pro day',
        suggestedTeams: [],
      }),
      'NFL',
    ],
    [
      'NCAA-only eligibility story',
      candidate({
        canonicalUrl: 'https://example.com/college-football/story',
        headline: 'Judge clarifies NCAA eligibility order',
        suggestedTeams: [],
      }),
      'NOT_NFL',
    ],
    [
      'NBA story',
      candidate({
        canonicalUrl: 'https://example.com/basketball/story',
        headline: 'NBA guard agrees to contract',
        suggestedTeams: [],
      }),
      'NOT_NFL',
    ],
    [
      'ambiguous sports story',
      candidate({
        canonicalUrl: 'https://example.com/story',
        headline: 'Veteran returns after long absence',
        suggestedTeams: [],
      }),
      'UNCERTAIN',
    ],
    [
      // M30A: an official team source is strong NFL evidence on its own -- this is what
      // lets an official-team feed skip the AI relevance classifier, even for a headline
      // with no NFL keywords and no team-name text match.
      'official team source with a generic headline and no team-name match',
      candidate({
        canonicalUrl: 'https://example.com/story',
        headline: 'Veteran returns after long absence',
        suggestedTeams: [],
        source: {
          kind: 'RSS',
          status: 'ACTIVE',
          isOfficialLeague: false,
          isOfficialTeam: true,
          allowsDescriptionUse: false,
          reliabilityWeight: 50,
          metadataRichnessWeight: 50,
          teamSpecificityWeight: 50,
          editorialUsefulnessWeight: 50,
          rightsProfile: null,
        },
      }),
      'NFL',
    ],
  ])('%s is classified as %s', (_label, value, expected) => {
    expect(deterministicRelevance(value).relevance).toBe(expected);
  });
});

describe('source sufficiency and generation gate', () => {
  it.each([
    [120, 'FULL_DRAFT_ELIGIBLE'],
    [40, 'SHORT_BRIEF_ELIGIBLE'],
    [0, 'LINK_ONLY'],
  ])('classifies %i authorized words as %s', (count, expected) => {
    expect(classifySufficiency(candidate(), 'fact '.repeat(count).trim() || null, 'NFL')).toBe(
      expected,
    );
  });

  it('classifies an empty headline record as insufficient', () => {
    expect(classifySufficiency(candidate({ headline: 'NFL update' }), null, 'NFL')).toBe(
      'INSUFFICIENT',
    );
  });

  it.each([
    ['FULL_DRAFT_ELIGIBLE', 'FULL_DRAFT'],
    ['SHORT_BRIEF_ELIGIBLE', 'SHORT_BRIEF'],
  ] as const)('allows %s generation without padding', async (sufficiency, mode) => {
    const baseSource = candidate().source;
    const rights = baseSource?.rightsProfile;
    if (baseSource === null || rights === null || rights === undefined)
      throw new Error('Expected source rights fixture');
    const value = candidate({
      sourceDescription: 'fact '.repeat(sufficiency === 'FULL_DRAFT_ELIGIBLE' ? 120 : 40),
      source: {
        ...baseSource,
        allowsDescriptionUse: true,
        rightsProfile: {
          ...rights,
          textUsage: 'SUMMARY_ALLOWED',
          reviewRequired: false,
        },
      },
    });
    await expect(
      new CandidateQualityService(repository(value)).requireGenerationEligibility(
        value.id,
        actor,
        null,
      ),
    ).resolves.toBe(mode);
  });

  it.each([
    [
      'non-NFL',
      candidate({
        canonicalUrl: 'https://x.test/college-football/a',
        headline: 'NCAA eligibility ruling',
        suggestedTeams: [],
      }),
      'UNIQUE',
    ],
    ['duplicate', candidate(), 'DUPLICATE'],
    ['insufficient', candidate({ headline: 'NFL update' }), 'UNIQUE'],
  ] as const)('blocks %s generation', async (_label, value, overlap) => {
    await expect(
      new CandidateQualityService(repository(value, overlap)).requireGenerationEligibility(
        value.id,
        actor,
        null,
      ),
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_GENERATION_ELIGIBLE' });
  });
});
