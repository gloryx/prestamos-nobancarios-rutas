export class PaymentValidationError extends Error {
  constructor(message: string, readonly reasonCode = 'PAYMENT_INVALID', readonly field?: string) { super(message); }
}
export class PaymentConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'PAYMENT_CONFLICT') { super(message); }
}
export class PaymentNotFoundError extends Error {}
