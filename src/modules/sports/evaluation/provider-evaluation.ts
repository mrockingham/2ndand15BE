import { writeFile } from 'node:fs/promises';

import { z } from 'zod';

const verificationStateSchema = z.enum(['verified', 'unavailable', 'untested']);
const findingLevelSchema = z.enum(['pass', 'warning', 'failure']);

function factSchema<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    state: verificationStateSchema,
    value: valueSchema.nullable(),
    note: z.string().min(1).max(500).nullable(),
  });
}

const coverageSchema = z.object({
  present: z.number().int().min(0),
  total: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
});

const seasonTypeCountsSchema = z.object({
  PRE: factSchema(z.number().int().min(0)),
  REG: factSchema(z.number().int().min(0)),
  POST: factSchema(z.number().int().min(0)),
});

export const providerEvaluationReportSchema = z.object({
  providerName: z.string().min(1).max(128),
  availableNflSeasons: factSchema(z.array(z.number().int().min(1920).max(2100))),
  currentSeasonAvailability: factSchema(z.boolean()),
  teamCount: factSchema(z.number().int().min(0)),
  gameCountBySeasonType: z.record(z.string().regex(/^\d{4}$/), seasonTypeCountsSchema),
  earliestGameDate: factSchema(z.iso.datetime({ offset: true })),
  latestGameDate: factSchema(z.iso.datetime({ offset: true })),
  statusValuesObserved: factSchema(z.array(z.string().min(1).max(64))),
  requiredFieldCoverage: factSchema(z.record(z.string(), coverageSchema)),
  nullableFieldCoverage: factSchema(z.record(z.string(), coverageSchema)),
  playByPlayEndpointAvailability: factSchema(z.boolean()),
  playByPlayFieldCoverage: factSchema(z.record(z.string(), coverageSchema)),
  estimatedRequestCount: z.number().int().min(0),
  evaluationTimestamp: z.iso.datetime({ offset: true }),
  findings: z
    .array(
      z.object({
        level: findingLevelSchema,
        code: z.string().regex(/^[A-Z0-9_]+$/),
        message: z.string().min(1).max(500),
        evidenceState: verificationStateSchema,
      }),
    )
    .min(1),
});

export type ProviderEvaluationReport = z.infer<typeof providerEvaluationReportSchema>;
export interface EvaluationFact<T> {
  readonly state: 'verified' | 'unavailable' | 'untested';
  readonly value: T | null;
  readonly note: string | null;
}

export interface ProviderEvaluator {
  readonly providerName: string;
  evaluate(): Promise<ProviderEvaluationReport>;
}

export async function runProviderEvaluation(
  evaluator: ProviderEvaluator,
): Promise<ProviderEvaluationReport> {
  const report = providerEvaluationReportSchema.parse(await evaluator.evaluate());
  if (report.providerName !== evaluator.providerName) {
    throw new Error('Provider evaluation report name does not match its evaluator.');
  }
  return report;
}

export function serializeProviderEvaluationReport(
  report: ProviderEvaluationReport,
  forbiddenSecrets: readonly string[] = [],
): string {
  const validated = providerEvaluationReportSchema.parse(report);
  const serialized = `${renderSummary(validated)}\n\n\`\`\`json\n${JSON.stringify(validated, null, 2)}\n\`\`\`\n`;
  assertCredentialSafeText(serialized, forbiddenSecrets);
  return serialized;
}

export async function writeProviderEvaluationReport(
  report: ProviderEvaluationReport,
  outputPath: string,
  forbiddenSecrets: readonly string[] = [],
): Promise<void> {
  await writeFile(outputPath, serializeProviderEvaluationReport(report, forbiddenSecrets), 'utf8');
}

export function verifiedFact<T>(value: T, note: string | null = null): EvaluationFact<T> {
  return { state: 'verified', value, note };
}

export function unavailableFact<T>(note: string): EvaluationFact<T> {
  return { state: 'unavailable', value: null, note };
}

export function untestedFact<T>(note: string): EvaluationFact<T> {
  return { state: 'untested', value: null, note };
}

export function assertCredentialSafeText(
  serialized: string,
  forbiddenSecrets: readonly string[],
): void {
  if (/x-apisports-key|x-rapidapi-key|authorization\s*:/i.test(serialized)) {
    throw new Error('Provider evaluation report contains a credential header name.');
  }
  for (const secret of forbiddenSecrets) {
    if (secret !== '' && serialized.includes(secret)) {
      throw new Error('Provider evaluation report contains a configured credential.');
    }
  }
}

function renderSummary(report: ProviderEvaluationReport): string {
  const findings = report.findings
    .map((finding) => `- **${finding.level.toUpperCase()} — ${finding.code}:** ${finding.message}`)
    .join('\n');
  return `# ${report.providerName} provider evaluation\n\nGenerated: ${report.evaluationTimestamp}\n\nThis report contains sanitized summaries only. Values marked unavailable or untested are not verified provider capabilities.\n\n## Findings\n\n${findings}\n\n## Structured evidence`;
}
