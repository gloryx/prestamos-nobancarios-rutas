import { ChangeRouteStatus, CreateRoute, GetRoute, ListRoutes, UpdateRoute } from '../application/use-cases/route.use-cases';
import { RouteApi } from '../infrastructure/api/route.api';
import { AssignCollectorToRoute, AssignCustomerToRoute, GetRouteAssignmentOptions } from '../application/use-cases/route-assignment.use-cases';
import { RouteAssignmentApi } from '../infrastructure/api/route-assignment.api';

const repository = new RouteApi();
const assignmentRepository = new RouteAssignmentApi();
export const routeUseCases = { list: new ListRoutes(repository), get: new GetRoute(repository), create: new CreateRoute(repository), update: new UpdateRoute(repository), changeStatus: new ChangeRouteStatus(repository), assignmentOptions: new GetRouteAssignmentOptions(assignmentRepository), assignCustomer: new AssignCustomerToRoute(assignmentRepository), assignCollector: new AssignCollectorToRoute(assignmentRepository) };
