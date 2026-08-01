import type { NormalizedGame, SeasonType } from '../normalized-game.js';
import type { SportsDataBatch, SportsDataProvider } from '../sports-data-provider.js';
import {
  type EvaluationFact,
  type ProviderEvaluationReport,
  type ProviderEvaluator,
  unavailableFact,
  untestedFact,
  verifiedFact,
} from './provider-evaluation.js';

export interface ApiSportsEvaluatorOptions {
  readonly provider: SportsDataProvider;
  readonly seasons: readonly number[];
  readonly currentSeason: number;
  readonly now?: () => Date;
}

export class ApiSportsEvaluator implements ProviderEvaluator {
  readonly providerName = 'API-Sports';
  private readonly provider: SportsDataProvider;
  private readonly seasons: readonly number[];
  private readonly currentSeason: number;
  private readonly now: () => Date;

  constructor(options: ApiSportsEvaluatorOptions) {
    this.provider = options.provider;
    this.seasons = [...new Set(options.seasons)].sort();
    this.currentSeason = options.currentSeason;
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(): Promise<ProviderEvaluationReport> {
    const teamResult = await safeBatch(() => this.provider.getTeams());
    const seasonResults = new Map<number, SportsDataBatch<NormalizedGame> | null>();
    for (const season of this.seasons) {
      seasonResults.set(season, await safeBatch(() => this.provider.getGames({ season })));
    }

    const availableSeasons = [...seasonResults.entries()]
      .filter((entry): entry is [number, SportsDataBatch<NormalizedGame>] => entry[1] !== null)
      .filter(([, batch]) => batch.records.length > 0)
      .map(([season]) => season);
    const allGames = [...seasonResults.values()].flatMap((batch) => batch?.records ?? []);
    const currentBatch = seasonResults.get(this.currentSeason);
    const currentAvailability = toCurrentAvailability(currentBatch);
    const totalFailures = [...seasonResults.values()].reduce(
      (total, batch) => total + (batch?.failures.length ?? 0),
      0,
    );

    return {
      providerName: this.providerName,
      availableNflSeasons: verifiedFact(
        availableSeasons,
        `Evaluated candidate seasons: ${this.seasons.join(', ')}.`,
      ),
      currentSeasonAvailability: currentAvailability,
      teamCount:
        teamResult === null
          ? unavailableFact('The team endpoint could not be evaluated.')
          : verifiedFact(teamResult.records.length),
      gameCountBySeasonType: Object.fromEntries(
        this.seasons.map((season) => [String(season), countSeasonTypes(seasonResults.get(season))]),
      ),
      earliestGameDate: gameDateFact(allGames, 'earliest'),
      latestGameDate: gameDateFact(allGames, 'latest'),
      statusValuesObserved:
        allGames.length === 0
          ? unavailableFact('No validated games were available for status inspection.')
          : verifiedFact([...new Set(allGames.map((game) => game.status))].sort()),
      requiredFieldCoverage:
        allGames.length === 0
          ? unavailableFact('No validated games were available for field inspection.')
          : verifiedFact(requiredCoverage(allGames)),
      nullableFieldCoverage:
        allGames.length === 0
          ? unavailableFact('No validated games were available for nullable-field inspection.')
          : verifiedFact(nullableCoverage(allGames)),
      playByPlayEndpointAvailability: untestedFact(
        'Play-by-play was outside this evaluation and no endpoint call was made.',
      ),
      playByPlayFieldCoverage: untestedFact('Play-by-play fields were outside this evaluation.'),
      estimatedRequestCount: 1 + this.seasons.length,
      evaluationTimestamp: this.now().toISOString(),
      findings: buildFindings(availableSeasons, currentAvailability, totalFailures),
    };
  }
}

async function safeBatch<T>(
  operation: () => Promise<SportsDataBatch<T>>,
): Promise<SportsDataBatch<T> | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

function toCurrentAvailability(
  batch: SportsDataBatch<NormalizedGame> | null | undefined,
): EvaluationFact<boolean> {
  if (batch === undefined || batch === null) {
    return unavailableFact('The configured current season could not be evaluated.');
  }
  return verifiedFact(
    batch.records.length > 0,
    batch.records.length > 0
      ? 'Validated current-season games were returned.'
      : 'No validated current-season games were returned.',
  );
}

function countSeasonTypes(batch: SportsDataBatch<NormalizedGame> | null | undefined) {
  if (batch === undefined || batch === null) {
    return {
      PRE: unavailableFact<number>('Season data was unavailable.'),
      REG: unavailableFact<number>('Season data was unavailable.'),
      POST: unavailableFact<number>('Season data was unavailable.'),
    };
  }
  return {
    PRE: verifiedFact(countBySeasonType(batch.records, 'PRE')),
    REG: verifiedFact(countBySeasonType(batch.records, 'REG')),
    POST: verifiedFact(countBySeasonType(batch.records, 'POST')),
  };
}

function countBySeasonType(games: readonly NormalizedGame[], seasonType: SeasonType): number {
  return games.filter((game) => game.seasonType === seasonType).length;
}

function gameDateFact(
  games: readonly NormalizedGame[],
  direction: 'earliest' | 'latest',
): EvaluationFact<string> {
  if (games.length === 0) return unavailableFact('No validated game dates were available.');
  const dates = games.map((game) => game.startTime).sort();
  const value = direction === 'earliest' ? dates.at(0) : dates.at(-1);
  return value === undefined
    ? unavailableFact('No validated game dates were available.')
    : verifiedFact(value);
}

function requiredCoverage(games: readonly NormalizedGame[]) {
  const total = games.length;
  const complete = { present: total, total, percentage: 100 };
  return {
    providerGameId: complete,
    season: complete,
    seasonType: complete,
    startTime: complete,
    status: complete,
    homeProviderTeamId: complete,
    awayProviderTeamId: complete,
  };
}

function nullableCoverage(games: readonly NormalizedGame[]) {
  return {
    scores: coverage(games.filter((game) => game.homeScore !== null).length, games.length),
    quarter: coverage(games.filter((game) => game.quarter !== null).length, games.length),
    clock: coverage(games.filter((game) => game.clock !== null).length, games.length),
    venueName: coverage(games.filter((game) => game.venueName !== null).length, games.length),
    venueCity: coverage(games.filter((game) => game.venueCity !== null).length, games.length),
    broadcastNetwork: coverage(
      games.filter((game) => game.broadcastNetwork !== null).length,
      games.length,
    ),
    providerLastUpdatedAt: coverage(
      games.filter((game) => game.providerLastUpdatedAt !== null).length,
      games.length,
    ),
  };
}

function coverage(present: number, total: number) {
  return { present, total, percentage: total === 0 ? 0 : (present / total) * 100 };
}

function buildFindings(
  availableSeasons: readonly number[],
  currentAvailability: EvaluationFact<boolean>,
  failures: number,
): ProviderEvaluationReport['findings'] {
  return [
    {
      level: availableSeasons.length > 0 ? 'pass' : 'failure',
      code: 'HISTORICAL_DATA_SUITABILITY',
      message:
        availableSeasons.length > 0
          ? 'Validated historical NFL game data is available.'
          : 'No validated historical NFL game data was available.',
      evidenceState: 'verified',
    },
    {
      level: currentAvailability.value === true ? 'pass' : 'failure',
      code: 'CURRENT_SEASON_SUITABILITY',
      message:
        currentAvailability.value === true
          ? 'Validated current-season NFL games are available.'
          : 'Validated current-season NFL games are not available.',
      evidenceState: currentAvailability.state,
    },
    {
      level: failures === 0 ? 'pass' : 'warning',
      code: 'RECORD_VALIDATION',
      message:
        failures === 0
          ? 'No provider records failed normalization.'
          : `${String(failures)} provider records failed normalization.`,
      evidenceState: 'verified',
    },
    {
      level: 'warning',
      code: 'PLAY_BY_PLAY_SUITABILITY',
      message: 'Live play-by-play suitability was not evaluated.',
      evidenceState: 'untested',
    },
  ];
}
