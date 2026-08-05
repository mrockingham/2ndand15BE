import { createHash } from 'node:crypto';

import { z } from 'zod';

const nullableText = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();
const nullableNumber = z.number().nullable().optional();

export const nflversePlayerSchema = z
  .looseObject({
    gsis_id: z.string().regex(/^(?:00-\d{7}|[A-Z]{3}\d{6})$/),
    display_name: z.string().trim().min(1).max(160),
    first_name: nullableText,
    last_name: nullableText,
    short_name: nullableText,
    football_name: nullableText,
    esb_id: nullableText,
    nfl_id: nullableText,
    pfr_id: nullableText,
    pff_id: nullableText,
    otc_id: nullableText,
    espn_id: nullableText,
    smart_id: nullableText,
    birth_date: nullableText,
    position_group: nullableText,
    position: nullableText,
    height: nullableInteger,
    weight: nullableInteger,
    headshot: nullableText,
    college_name: nullableText,
    jersey_number: nullableText,
    rookie_season: nullableInteger,
    last_season: nullableInteger,
    latest_team: nullableText,
    status: nullableText,
    draft_year: nullableInteger,
    draft_round: nullableInteger,
    draft_pick: nullableInteger,
    draft_team: nullableText,
  })
  .superRefine((value, context) => {
    if (
      value.birth_date !== null &&
      value.birth_date !== undefined &&
      !/^\d{4}-\d{2}-\d{2}$/.test(value.birth_date)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['birth_date'],
        message: 'Birth date must be YYYY-MM-DD.',
      });
    }
    if (value.headshot !== null && value.headshot !== undefined && !isHttpUrl(value.headshot)) {
      context.addIssue({
        code: 'custom',
        path: ['headshot'],
        message: 'Headshot must use HTTP or HTTPS.',
      });
    }
  });

export const nflverseRosterSchema = z
  .looseObject({
    season: z.number().int().min(2020).max(2025),
    team: z.string().trim().min(1).max(16),
    position: nullableText,
    depth_chart_position: nullableText,
    jersey_number: nullableInteger,
    status: nullableText,
    full_name: z.string().trim().min(1).max(160),
    first_name: nullableText,
    last_name: nullableText,
    headshot_url: nullableText,
    gsis_id: nullableText,
    espn_id: nullableText,
    sportradar_id: nullableText,
    yahoo_id: nullableText,
    pff_id: nullableText,
    pfr_id: nullableText,
    sleeper_id: nullableText,
    years_exp: nullableInteger,
    week: z.number().int().min(1).max(22),
    game_type: z.enum(['PRE', 'REG', 'POST', 'WC', 'DIV', 'CON', 'SB']),
    status_description_abbr: nullableText,
    football_name: nullableText,
    esb_id: nullableText,
    smart_id: nullableText,
  })
  .superRefine((value, context) => {
    const identities = [value.gsis_id, value.smart_id, value.esb_id, value.espn_id].filter(
      (entry): entry is string => entry !== null && entry !== undefined && entry.trim() !== '',
    );
    if (identities.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['gsis_id'],
        message: 'At least one reviewed external player identifier is required.',
      });
    }
  });

export const nflversePlayerStatSchema = z
  .looseObject({
    player_id: z.string().regex(/^00-\d{7}$/),
    player_display_name: z.string().trim().min(1).max(160).nullable(),
    position: nullableText,
    position_group: nullableText,
    season: z.number().int().min(2020).max(2025),
    week: z.number().int().min(1).max(22),
    season_type: z.enum(['PRE', 'REG', 'POST']),
    game_id: z.string().regex(/^\d{4}_(?:\d{2}|WC|DIV|CON|SB)_[A-Z]{2,3}_[A-Z]{2,3}$/),
    team: z.string().trim().min(2).max(3),
    opponent_team: z.string().trim().min(2).max(3),
    completions: nullableInteger,
    attempts: nullableInteger,
    passing_yards: nullableInteger,
    passing_tds: nullableInteger,
    passing_interceptions: nullableInteger,
    sacks_suffered: nullableInteger,
    sack_yards_lost: nullableInteger,
    passing_air_yards: nullableInteger,
    passing_yards_after_catch: nullableInteger,
    passing_first_downs: nullableInteger,
    passing_epa: nullableNumber,
    passing_2pt_conversions: nullableInteger,
    carries: nullableInteger,
    rushing_yards: nullableInteger,
    rushing_tds: nullableInteger,
    rushing_first_downs: nullableInteger,
    rushing_epa: nullableNumber,
    rushing_fumbles: nullableInteger,
    rushing_fumbles_lost: nullableInteger,
    rushing_2pt_conversions: nullableInteger,
    targets: nullableInteger,
    receptions: nullableInteger,
    receiving_yards: nullableInteger,
    receiving_tds: nullableInteger,
    receiving_air_yards: nullableInteger,
    receiving_yards_after_catch: nullableInteger,
    receiving_first_downs: nullableInteger,
    receiving_epa: nullableNumber,
    target_share: nullableNumber,
    receiving_2pt_conversions: nullableInteger,
    fumbles_total: nullableInteger,
    fumbles_lost_total: nullableInteger,
    def_tackles_solo: nullableInteger,
    def_tackles_with_assist: nullableInteger,
    def_tackle_assists: nullableInteger,
    def_tackles_for_loss: nullableInteger,
    def_sacks: nullableNumber,
    def_sack_yards: nullableNumber,
    def_qb_hits: nullableInteger,
    def_interceptions: nullableInteger,
    def_interception_yards: nullableInteger,
    def_pass_defended: nullableInteger,
    def_fumbles_forced: nullableInteger,
    fumble_recovery_opp: nullableInteger,
    def_tds: nullableInteger,
    fg_made: nullableInteger,
    fg_att: nullableInteger,
    pat_made: nullableInteger,
    pat_att: nullableInteger,
    pt_att: nullableInteger,
    pt_yards: nullableInteger,
    punt_return_yards: nullableInteger,
    pt_return_tds: nullableInteger,
    kickoff_return_yards: nullableInteger,
    special_teams_tds: nullableInteger,
    fantasy_points: nullableNumber,
    fantasy_points_ppr: nullableNumber,
  })
  .superRefine(validateStatRelationships);

export type NflversePlayer = z.output<typeof nflversePlayerSchema>;
export type NflverseRoster = z.output<typeof nflverseRosterSchema>;
export type NflversePlayerStat = z.output<typeof nflversePlayerStatSchema>;

const NON_NEGATIVE_STAT_FIELDS = [
  'completions',
  'attempts',
  'passing_tds',
  'passing_interceptions',
  'sacks_suffered',
  'passing_first_downs',
  'passing_2pt_conversions',
  'carries',
  'rushing_tds',
  'rushing_first_downs',
  'rushing_fumbles',
  'rushing_fumbles_lost',
  'rushing_2pt_conversions',
  'targets',
  'receptions',
  'receiving_tds',
  'receiving_first_downs',
  'receiving_2pt_conversions',
  'fumbles_total',
  'fumbles_lost_total',
  'def_tackles_solo',
  'def_tackles_with_assist',
  'def_tackle_assists',
  'def_tackles_for_loss',
  'def_sacks',
  'def_qb_hits',
  'def_interceptions',
  'def_pass_defended',
  'def_fumbles_forced',
  'fumble_recovery_opp',
  'def_tds',
  'fg_made',
  'fg_att',
  'pat_made',
  'pat_att',
  'pt_att',
  'special_teams_tds',
] as const;

function validateStatRelationships(
  value: z.output<typeof nflversePlayerStatSchema>,
  context: z.RefinementCtx,
): void {
  for (const field of NON_NEGATIVE_STAT_FIELDS) {
    const number = value[field];
    if (number !== null && number !== undefined && number < 0) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Counting statistic cannot be negative.',
      });
    }
  }
  compare(
    value.completions,
    value.attempts,
    'completions',
    'Completions cannot exceed attempts.',
    context,
  );
  compare(
    value.receptions,
    value.targets,
    'receptions',
    'Receptions cannot exceed targets.',
    context,
  );
  compare(
    value.fg_made,
    value.fg_att,
    'fg_made',
    'Field goals made cannot exceed attempts.',
    context,
  );
  compare(
    value.pat_made,
    value.pat_att,
    'pat_made',
    'Extra points made cannot exceed attempts.',
    context,
  );
}

function compare(
  left: number | null | undefined,
  right: number | null | undefined,
  field: string,
  message: string,
  context: z.RefinementCtx,
): void {
  if (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left > right
  ) {
    context.addIssue({ code: 'custom', path: [field], message });
  }
}

export function canonicalTeamAbbreviation(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (['FA', 'RET', 'RES', 'UNK', ''].includes(normalized)) return null;
  const aliases: Readonly<Record<string, string>> = {
    JAC: 'JAX',
    WSH: 'WAS',
    OAK: 'LV',
    SD: 'LAC',
    STL: 'LAR',
    LA: 'LAR',
  };
  return aliases[normalized] ?? normalized;
}

export function normalizeRosterSeasonType(
  value: NflverseRoster['game_type'],
): 'PRE' | 'REG' | 'POST' {
  return value === 'PRE' || value === 'REG' ? value : 'POST';
}

export function nflversePlayerIdentifiers(
  player: NflversePlayer,
): readonly (readonly [string, string])[] {
  const candidates: readonly (readonly [string, string | null | undefined])[] = [
    ['GSIS', /^00-\d{7}$/.test(player.gsis_id) ? player.gsis_id : null],
    ['ESB', player.esb_id],
    ['NFL', player.nfl_id],
    ['PFR', player.pfr_id],
    ['PFF', player.pff_id],
    ['OTC', player.otc_id],
    ['ESPN', player.espn_id],
    ['SMART', player.smart_id],
  ];
  return candidates.flatMap(([provider, value]) => {
    const id = cleanOptionalText(value);
    return id === null ? [] : [[provider, id] as const];
  });
}

export function nflverseRosterIdentifiers(
  roster: NflverseRoster,
): readonly (readonly [string, string])[] {
  const candidates: readonly (readonly [string, string | null | undefined])[] = [
    ['GSIS', cleanOptionalText(roster.gsis_id)],
    ['SMART', roster.smart_id],
    ['ESB', roster.esb_id],
    ['ESPN', roster.espn_id],
    ['PFR', roster.pfr_id],
    ['PFF', roster.pff_id],
    ['SPORTRADAR', roster.sportradar_id],
    ['YAHOO', roster.yahoo_id],
    ['SLEEPER', roster.sleeper_id],
  ];
  return candidates.flatMap(([provider, value]) => {
    const id = cleanOptionalText(value);
    return id === null ? [] : [[provider, id] as const];
  });
}

export function normalizePlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizePosition(value: string | null | undefined): string | null {
  const position = value?.trim().toUpperCase();
  if (position === undefined || position === '') return null;
  const aliases: Readonly<Record<string, string>> = { HB: 'RB', FB: 'RB', NT: 'DT', DE: 'DL' };
  return aliases[position] ?? position;
}

export function cleanOptionalText(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result === undefined || result === '' ? null : result;
}

export function parseOptionalInteger(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function sourceRowHash(value: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
    (_key, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry),
  );
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
