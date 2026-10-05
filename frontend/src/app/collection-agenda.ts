import { CollectionAgendaController } from '../application/use-cases/collection-agenda-controller';
import { collectionAgendaApi } from '../infrastructure/api/collection-agenda.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export const createCollectionAgenda = () => new CollectionAgendaController(collectionAgendaApi, costaRicaDateOnly);
