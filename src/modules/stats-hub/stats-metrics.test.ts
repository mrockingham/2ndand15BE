import { describe, expect, it } from 'vitest';

import {
  STATS_CATEGORY_ORDER,
  STATS_METRICS,
  toPublicMetricDefinition,
  validateStatsMetrics,
  type StatsMetricDefinition,
} from './stats-metrics.js';

describe('Stats Hub metric registry', () => {
  it('has stable unique IDs in category order', () => {
    expect(STATS_METRICS).toHaveLength(20);
    expect(new Set(STATS_METRICS.map(({ id }) => id)).size).toBe(STATS_METRICS.length);
    const categoryIndexes = STATS_METRICS.map(({ category }) =>
      STATS_CATEGORY_ORDER.indexOf(category),
    );
    expect(categoryIndexes).toEqual([...categoryIndexes].sort((left, right) => left - right));
  });

  it('maps every metric to reviewed stored fields and a public context', () => {
    const storedFields = new Set([
      'passingYards',
      'passingTouchdowns',
      'completions',
      'attempts',
      'passingInterceptions',
      'rushingYards',
      'rushingTouchdowns',
      'carries',
      'receivingYards',
      'receivingTouchdowns',
      'receptions',
      'targets',
      'tacklesSolo',
      'tackleAssists',
      'defensiveSacks',
      'defensiveInterceptions',
      'forcedFumbles',
      'fieldGoalsMade',
      'fieldGoalsAttempted',
      'extraPointsMade',
    ]);
    for (const metric of STATS_METRICS) {
      expect(metric.seasonFields.every((field) => storedFields.has(field))).toBe(true);
      expect(metric.gameFields.every((field) => storedFields.has(field))).toBe(true);
      expect(metric.availableForSeasonLeaders).toBe(true);
      expect(metric.availableForWeekLeaders).toBe(true);
      expect(metric.availableForRecentPerformance).toBe(true);
      expect(metric.qualification).toBeNull();
    }
  });

  it('rejects duplicate IDs and unsupported category mappings', () => {
    expect(() => {
      validateStatsMetrics([STATS_METRICS[0], STATS_METRICS[0]]);
    }).toThrow(/Duplicate/);
    const invalid: StatsMetricDefinition = { ...STATS_METRICS[0], category: 'KICKING' };
    expect(() => {
      validateStatsMetrics([invalid]);
    }).toThrow(/unsupported category/);
    const invalidField = {
      ...STATS_METRICS[0],
      seasonFields: ['clientSelectedColumn'],
    } as unknown as StatsMetricDefinition;
    expect(() => {
      validateStatsMetrics([invalidField]);
    }).toThrow(/nonexistent internal field/);
  });

  it('never publishes database source fields', () => {
    const serialized = JSON.stringify(STATS_METRICS.map(toPublicMetricDefinition));
    expect(serialized).not.toContain('source');
    expect(serialized).not.toContain('seasonFields');
    expect(serialized).not.toContain('gameFields');
  });
});
