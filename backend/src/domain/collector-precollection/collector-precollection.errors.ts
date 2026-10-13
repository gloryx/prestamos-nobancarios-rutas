export class CollectorPrecollectionValidationError extends Error {
  constructor(message: string, readonly reasonCode = 'PRECOLLECTION_INVALID', readonly field?: string) {
    super(message);
  }
}

export class CollectorPrecollectionConflictError extends Error {
  constructor(message: string, readonly reasonCode = 'PRECOLLECTION_STATE_CONFLICT') {
    super(message);
  }
}

export class CollectorPrecollectionNotFoundError extends Error {}
export class CollectorPrecollectionForbiddenError extends Error {}
