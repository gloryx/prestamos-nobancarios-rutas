export class PaymentFrequencyNotFoundError extends Error {
  constructor(id: string) { super(`Payment frequency ${id} was not found`); }
}

export class PaymentFrequencyNameAlreadyExistsError extends Error {
  constructor() { super('Payment frequency name already exists'); }
}
