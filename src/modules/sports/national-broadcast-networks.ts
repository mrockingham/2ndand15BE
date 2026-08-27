/**
 * Conservative national-broadcast allowlist for the M27 featured-game rule.
 *
 * Grounded in the actual 2026 schedule's `broadcastNetwork` values. FOX (95 rows) and CBS
 * (94 rows) dominate the dataset because they carry the regional Sunday-afternoon package —
 * many different simultaneous regional games share that network label, so treating either as
 * "national" would feature nearly every Sunday game and defeat the purpose of this rule. Only
 * networks whose 2026 game counts are consistent with a single exclusive national window are
 * included: NFL Network and Prime Video (Thursday night), NBC (Sunday night), ESPN/ABC (Monday
 * night, simulcast), and Netflix (holiday exclusives). FOX and CBS are deliberately excluded as
 * ambiguous. Revisit this list if the schedule's broadcast modeling changes to distinguish a
 * network's national game of the week from its simultaneous regional broadcasts.
 */
const NATIONAL_BROADCAST_NETWORKS: ReadonlySet<string> = new Set([
  'NFL NETWORK',
  'ESPN',
  'ABC',
  'NBC',
  'PRIME VIDEO',
  'AMAZON PRIME VIDEO',
  'NETFLIX',
]);

export function isNationalBroadcast(broadcastNetwork: string | null): boolean {
  if (broadcastNetwork === null) return false;
  return NATIONAL_BROADCAST_NETWORKS.has(broadcastNetwork.trim().toUpperCase());
}
