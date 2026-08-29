/**
 * M42A: a config/service-level editorial-role classification for
 * `NewsSource`, deliberately not a new database enum -- the ticket that
 * introduced it only needed this for reporting and future
 * selection/composition logic to reason about source diversity, not for a
 * new persisted field. Classification is deterministic and derives from
 * existing `NewsSource` fields wherever possible.
 *
 * `NATIONAL_REPORTING_SLUGS` is the one deliberate exception to "never
 * branch on publisher identity": there is no existing field that
 * distinguishes an editorially independent national outlet (ESPN,
 * ProFootballTalk, CBS Sports) from any other non-official `ARTICLE`
 * source, so identity is the only signal available for that one role. Every
 * other consumer of source editorial role should call
 * `classifySourceEditorialRole` rather than adding its own slug check.
 */

export type SourceEditorialRole = 'NATIONAL_REPORTING' | 'OFFICIAL_TEAM' | 'VIDEO_FIRST' | 'OTHER';

const NATIONAL_REPORTING_SLUGS = new Set<string>([
  'espn-nfl-news',
  'profootballtalk',
  'cbs-sports-nfl',
]);

export interface SourceEditorialRoleInput {
  readonly slug: string;
  readonly isOfficialTeam: boolean;
  readonly contentType: 'ARTICLE' | 'VIDEO' | 'HIGHLIGHT';
}

export function classifySourceEditorialRole(source: SourceEditorialRoleInput): SourceEditorialRole {
  if (source.isOfficialTeam) return 'OFFICIAL_TEAM';
  if (source.contentType !== 'ARTICLE') return 'VIDEO_FIRST';
  if (NATIONAL_REPORTING_SLUGS.has(source.slug)) return 'NATIONAL_REPORTING';
  return 'OTHER';
}
