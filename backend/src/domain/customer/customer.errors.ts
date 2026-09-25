export class CustomerValidationError extends Error { constructor(message: string) { super(message); this.name = 'CustomerValidationError'; } }
export class CustomerIdentificationAlreadyExistsError extends Error { constructor() { super('Ya existe un cliente con esta identificación.'); this.name = 'CustomerIdentificationAlreadyExistsError'; } }
export class DistrictNotFoundError extends Error { constructor() { super('El distrito seleccionado no existe.'); this.name = 'DistrictNotFoundError'; } }
export class CustomerNotFoundError extends Error { constructor() { super('El cliente no existe.'); this.name = 'CustomerNotFoundError'; } }
export class CustomerFileNotFoundError extends Error { constructor() { super('El archivo solicitado no existe.'); this.name = 'CustomerFileNotFoundError'; } }
