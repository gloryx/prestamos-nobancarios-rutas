import { ProfitabilityController } from '../application/use-cases/profitability-controller';
import { profitabilityApi } from '../infrastructure/api/profitability.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export const createProfitability = () => new ProfitabilityController(profitabilityApi, costaRicaDateOnly().slice(0, 7));
