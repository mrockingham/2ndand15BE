import type { Team } from '../../generated/prisma/client.js';

export function createTeamRecord(overrides: Partial<Team> = {}): Team {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    league: 'NFL',
    city: 'Buffalo',
    name: 'Bills',
    fullName: 'Buffalo Bills',
    abbreviation: 'BUF',
    conference: 'AFC',
    division: 'East',
    primaryColor: '#00338D',
    secondaryColor: '#C60C30',
    logoUrl: null,
    logoSource: null,
    isActive: true,
    createdAt: new Date('2026-07-28T12:00:00.000Z'),
    updatedAt: new Date('2026-07-28T12:00:00.000Z'),
    ...overrides,
  };
}
