import type { CurrentIdentity } from '../../domain/security/security.types';

export type CollectorFinancialSummary = {
  totalPlaced: string;
  totalOutstanding: string;
  realizedGain: string;
  activeLoansCount: number;
};

export interface CollectorFinancialSummaryReader {
  read(collectorUserId: string): Promise<CollectorFinancialSummary | null>;
}

export const COLLECTOR_FINANCIAL_SUMMARY_READER = Symbol('COLLECTOR_FINANCIAL_SUMMARY_READER');
export class CollectorFinancialSummaryForbiddenError extends Error {}
export class CollectorFinancialSummaryIntegrityError extends Error {}

export class CollectorFinancialSummaryUseCase {
  constructor(private readonly reader: CollectorFinancialSummaryReader) {}

  async execute(actor: CurrentIdentity): Promise<CollectorFinancialSummary> {
    if (actor.role.isSuperAdmin || actor.role.code !== 'COLLECTOR')
      throw new CollectorFinancialSummaryForbiddenError('El resumen financiero está disponible únicamente para cobradores activos.');
    const summary = await this.reader.read(actor.id);
    if (!summary) throw new CollectorFinancialSummaryForbiddenError('El usuario autenticado no posee un perfil de cobrador activo.');
    return summary;
  }
}
