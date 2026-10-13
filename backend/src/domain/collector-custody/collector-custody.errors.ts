export class CollectorCustodyValidationError extends Error {
  constructor(message: string, readonly reasonCode = 'CUSTODY_INVALID', readonly field?: string) { super(message); }
}
export class CollectorCustodyConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'CUSTODY_CONFLICT') { super(message); }
}
export class CollectorCustodyForbiddenError extends Error {}
export class CollectorCustodyNotFoundError extends Error {}
