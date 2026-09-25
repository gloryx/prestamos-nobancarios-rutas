import { ChangeCollectorStatus, CreateCollector, GetCollector, GetCollectorPhoto, LinkCollectorUser, ListCollectors, ListEligibleCollectorUsers, UpdateCollector } from '../application/use-cases/collector.use-cases';
import { CollectorApi } from '../infrastructure/api/collector.api';

const repository = new CollectorApi();
export const collectorUseCases = { list: new ListCollectors(repository), get: new GetCollector(repository), create: new CreateCollector(repository), update: new UpdateCollector(repository), changeStatus: new ChangeCollectorStatus(repository), linkUser: new LinkCollectorUser(repository), eligibleUsers: new ListEligibleCollectorUsers(repository), photo: new GetCollectorPhoto(repository) };
