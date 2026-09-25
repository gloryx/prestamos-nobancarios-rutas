export class FinancialOpeningValidationError extends Error {}
export class FinancialOpeningAlreadyPerformedError extends Error {
  constructor() { super('La apertura financiera ya fue realizada.'); }
}
