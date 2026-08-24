import type { Game } from '../../generated/prisma/client.js';
import { createTeamRecord } from '../teams/team.test-fixtures.js';
import type { GameWithTeams } from './game.dto.js';

export function createGameRecord(overrides: Partial<Game> = {}): GameWithTeams {
  const homeTeam = createTeamRecord();
  const awayTeam = createTeamRecord({
    id: '00000000-0000-4000-8000-000000000002',
    city: 'Miami',
    name: 'Dolphins',
    fullName: 'Miami Dolphins',
    abbreviation: 'MIA',
    primaryColor: '#008E97',
    secondaryColor: '#FC4C02',
  });
  return {
    id: '00000000-0000-4000-8000-000000000101',
    league: 'NFL',
    season: 2026,
    seasonType: 'REG',
    week: 1,
    startTime: new Date('2026-09-10T00:20:00.000Z'),
    status: 'SCHEDULED',
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeScore: null,
    awayScore: null,
    quarter: null,
    clock: null,
    venueName: null,
    venueCity: 'Buffalo',
    broadcastNetwork: null,
    isNeutralSite: false,
    providerLastUpdatedAt: null,
    manualFeatured: null,
    manualFeaturedReason: null,
    manualFeaturedById: null,
    manualFeaturedAt: null,
    createdAt: new Date('2026-07-31T12:00:00.000Z'),
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    editorialOverride: null,
    homeTeam,
    awayTeam,
    ...overrides,
  };
}
