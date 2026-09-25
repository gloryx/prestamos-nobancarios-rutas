import { ChangeRouteStatus, CreateRoute, GetRoute, ListRoutes, UpdateRoute } from '../application/use-cases/route.use-cases';
import { RouteApi } from '../infrastructure/api/route.api';

const repository = new RouteApi();
export const routeUseCases = { list: new ListRoutes(repository), get: new GetRoute(repository), create: new CreateRoute(repository), update: new UpdateRoute(repository), changeStatus: new ChangeRouteStatus(repository) };
