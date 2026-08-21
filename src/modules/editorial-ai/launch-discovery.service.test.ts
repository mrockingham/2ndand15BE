import { describe, expect, it, vi } from 'vitest';

import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { NewsInboxServiceContract } from '../news-inbox/news.service.js';
import type { CandidateQualityGate, CandidateQualityResult } from './candidate-quality.service.js';
import {
  LaunchDiscoveryService,
  selectPilotTeams,
  type LaunchDiscoveryRepository,
} from './launch-discovery.service.js';

const actor: AdministrativePrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'editor@example.com',
  role: 'EDITOR',
};

const teams = [
  { id: 'buf', abbreviation: 'BUF', opportunityCount: 1 },
  { id: 'ari', abbreviation: 'ARI', opportunityCount: 0 },
  { id: 'atl', abbreviation: 'ATL', opportunityCount: 0 },
  { id: 'bal', abbreviation: 'BAL', opportunityCount: 0 },
  { id: 'car', abbreviation: 'CAR', opportunityCount: 0 },
];

describe('launch discovery', () => {
  it('selects one covered and three zero-coverage teams dynamically', () => {
    expect(selectPilotTeams(teams).map(({ abbreviation }) => abbreviation)).toEqual([
      'BUF',
      'ARI',
      'ATL',
      'BAL',
    ]);
  });

  it('reuses approved feeds, deduplicates, evaluates, and never generates or publishes', async () => {
    const repository = {
      listActiveSources: vi
        .fn()
        .mockResolvedValue([{ id: 'source', name: 'NFL feed', kind: 'RSS' }]),
      listTeamsByGap: vi.fn().mockResolvedValue(teams),
      listCandidateIds: vi.fn().mockResolvedValue(['candidate']),
      sourceDiversity: vi.fn().mockResolvedValue(1),
    } satisfies LaunchDiscoveryRepository;
    const ingestSource = vi.fn().mockResolvedValue({
      run: { fetchedCount: 12, createdCount: 4, updatedCount: 1, skippedCount: 7 },
    });
    const news = { ingestSource } as unknown as NewsInboxServiceContract;
    const qualityResult = {
      candidateId: 'candidate',
      relevance: 'NFL',
      decision: 'NFL_RELEVANT_LINK_ONLY',
    } as CandidateQualityResult;
    const quality = {
      evaluateBatch: vi.fn().mockResolvedValue({ results: [qualityResult] }),
    } as unknown as CandidateQualityGate;
    const result = await new LaunchDiscoveryService(repository, news, quality).discover(
      { targetPerTeam: 10, freshnessDays: 14, maxNewCandidates: 10, pilot: true },
      actor,
      null,
    );
    expect(result).toMatchObject({
      mode: 'PILOT',
      sourceRequests: 1,
      rawResults: 12,
      created: 4,
      deduplicated: 7,
      usefulCandidates: 1,
      articleGenerationCount: 0,
      publicationCount: 0,
    });
    expect(ingestSource).toHaveBeenCalledWith('source', actor, null, 10);
  });
});
