import type { CollectorFinancialSummary } from '../../domain/entities/collector';

export function loadPermittedCollectorFinancialSummary(
  allowed: boolean,
  load: () => Promise<CollectorFinancialSummary>,
): Promise<CollectorFinancialSummary | undefined> {
  return allowed ? load() : Promise.resolve(undefined);
}
