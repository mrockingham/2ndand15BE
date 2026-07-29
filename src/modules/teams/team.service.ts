import { AppError } from '../../common/errors/app-error.js';
import { toTeamDto, type TeamDto } from './team.dto.js';
import type { TeamRepository } from './team.repository.js';

export interface TeamReader {
  listActiveTeams(): Promise<readonly TeamDto[]>;
  getActiveTeam(teamId: string): Promise<TeamDto>;
}

export class TeamService implements TeamReader {
  constructor(private readonly repository: TeamRepository) {}

  async listActiveTeams(): Promise<readonly TeamDto[]> {
    const teams = await this.repository.findActiveTeams();
    return teams.map(toTeamDto).sort(compareTeams);
  }

  async getActiveTeam(teamId: string): Promise<TeamDto> {
    const team = await this.repository.findActiveTeamById(teamId);

    if (team === null) {
      throw new AppError({
        code: 'TEAM_NOT_FOUND',
        message: 'The requested active team was not found.',
        statusCode: 404,
      });
    }

    return toTeamDto(team);
  }
}

function compareTeams(left: TeamDto, right: TeamDto): number {
  return (
    left.conference.localeCompare(right.conference) ||
    left.division.localeCompare(right.division) ||
    left.fullName.localeCompare(right.fullName)
  );
}
