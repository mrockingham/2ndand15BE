import type { NormalizedTeam } from './normalized-team.js';

export interface SportsDataProvider {
  getTeams(): Promise<readonly NormalizedTeam[]>;
}
