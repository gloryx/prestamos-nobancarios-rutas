export class PaymentMethodNotFoundError extends Error {
  constructor(id: string) { super(`Payment method ${id} was not found`); }
}

export class PaymentMethodNameAlreadyExistsError extends Error {
  constructor() { super('Payment method name already exists'); }
}
