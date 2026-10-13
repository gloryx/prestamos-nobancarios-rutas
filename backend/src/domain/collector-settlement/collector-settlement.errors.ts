export class CollectorSettlementValidationError extends Error {
  constructor(message: string, readonly reasonCode = 'SETTLEMENT_INVALID', readonly field?: string) { super(message); }
}
export class CollectorSettlementConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'SETTLEMENT_STATE_CONFLICT') { super(message); }
}
export class CollectorSettlementForbiddenError extends Error {}
export class CollectorSettlementNotFoundError extends Error {}
