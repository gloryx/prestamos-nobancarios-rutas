export class CollectorValidationError extends Error { constructor(message: string) { super(message); this.name = 'CollectorValidationError'; } }
export class CollectorNotFoundError extends Error { constructor() { super('El cobrador no existe.'); this.name = 'CollectorNotFoundError'; } }
export class CollectorIdentificationAlreadyExistsError extends Error { constructor() { super('Ya existe un cobrador con esta identificación.'); this.name = 'CollectorIdentificationAlreadyExistsError'; } }
export class CollectorUserAlreadyLinkedError extends Error { constructor() { super('El usuario ya está vinculado a otro cobrador.'); this.name = 'CollectorUserAlreadyLinkedError'; } }
export class CollectorUserNotEligibleError extends Error { constructor() { super('El usuario debe estar activo y tener el rol COBRADOR.'); this.name = 'CollectorUserNotEligibleError'; } }
export class CollectorUnauthorizedAssociationError extends Error { constructor() { super('No tiene permiso para vincular usuarios a cobradores.'); this.name = 'CollectorUnauthorizedAssociationError'; } }
export class CollectorPhotoNotFoundError extends Error { constructor() { super('La fotografía del cobrador no existe.'); this.name = 'CollectorPhotoNotFoundError'; } }
