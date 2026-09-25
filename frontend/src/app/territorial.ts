import { TerritorialApi } from '../infrastructure/api/territorial.api';
import { ListCantons, ListDistricts, ListProvinces } from '../application/use-cases/territorial.use-cases';

const territorialRepository = new TerritorialApi();

export const territorialUseCases = {
  listProvinces: new ListProvinces(territorialRepository),
  listCantons: new ListCantons(territorialRepository),
  listDistricts: new ListDistricts(territorialRepository),
};
