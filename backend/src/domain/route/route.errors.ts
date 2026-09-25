export class RouteNotFoundError extends Error {
  constructor(id: string) { super(`Route ${id} was not found`); }
}

export class RouteNameAlreadyExistsError extends Error {
  constructor() { super('Route name already exists'); }
}
