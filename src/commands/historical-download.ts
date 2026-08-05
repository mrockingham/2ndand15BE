import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

import { downloadHistoricalFile } from '../modules/historical-stats/historical-download.js';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    seasons: { type: 'string', default: '2025' },
    output: { type: 'string', default: './data/nflverse' },
  },
});
if (
  !['players', 'weekly-rosters', 'player-stats', 'player-season-stats', 'schedules'].includes(
    values.dataset ?? '',
  )
) {
  throw new Error(
    '--dataset must be players, weekly-rosters, player-stats, player-season-stats, or schedules.',
  );
}
const dataset = values.dataset as
  'players' | 'weekly-rosters' | 'player-stats' | 'player-season-stats' | 'schedules';
const seasons = parseSeasons(values.seasons);
const downloads =
  dataset === 'players'
    ? [
        {
          url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
          path: 'players/players.parquet',
        },
      ]
    : dataset === 'schedules'
      ? [
          {
            url: 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv',
            path: 'schedules/games.csv',
          },
        ]
      : seasons.map((season) =>
          dataset === 'weekly-rosters'
            ? {
                url: `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${String(season)}.parquet`,
                path: `weekly-rosters/roster_weekly_${String(season)}.parquet`,
              }
            : dataset === 'player-stats'
              ? {
                  url: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${String(season)}.parquet`,
                  path: `player-stats/stats_player_week_${String(season)}.parquet`,
                }
              : {
                  url: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${String(season)}.parquet`,
                  path: `season-summaries/stats_player_reg_${String(season)}.parquet`,
                },
        );
const results = [];
for (const item of downloads)
  results.push(
    await downloadHistoricalFile({ url: item.url, destination: resolve(values.output, item.path) }),
  );
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

function parseSeasons(value: string): number[] {
  const match = /^(202[0-5])(?:-(202[0-5]))?$/.exec(value);
  if (match === null) throw new Error('--seasons must be one season or a 2020-2025 range.');
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (end < start) throw new Error('--seasons range must be ascending.');
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
