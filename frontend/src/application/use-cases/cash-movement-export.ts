import type { CashMovement, CashMovementFilters } from '../../domain/entities/cash-movement';
import type { CashMovementRepository } from '../ports/cash-movement.repository';

export async function collectAllCashMovements(repository: Pick<CashMovementRepository, 'list'>, filters: Omit<CashMovementFilters, 'page' | 'pageSize'>): Promise<CashMovement[]> {
  const records: CashMovement[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (records.length < total) {
    const result = await repository.list({ ...filters, page, pageSize: 100 });
    records.push(...result.items);
    total = result.total;
    if (result.items.length === 0) break;
    page += 1;
  }
  return records;
}
