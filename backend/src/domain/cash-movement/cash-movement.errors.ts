export class CashMovementValidationError extends Error {
  constructor(message: string, readonly reasonCode = 'CASH_MOVEMENT_INVALID', readonly field?: string) { super(message); }
}
export class CashMovementConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'CASH_MOVEMENT_CONFLICT') { super(message); }
}
export class CashMovementNotFoundError extends Error {}
