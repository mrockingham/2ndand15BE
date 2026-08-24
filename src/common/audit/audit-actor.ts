export interface AuditActor {
  readonly userId: string | null;
  readonly emailSnapshot: string;
  readonly requestId: string | null;
}
