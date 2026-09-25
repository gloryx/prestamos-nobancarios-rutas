import { EntityManager } from 'typeorm';

const defaults = [
  { name: 'Diario', intervalUnit: 'DAY', intervalValue: 1, order: 1 },
  { name: 'Semanal', intervalUnit: 'WEEK', intervalValue: 1, order: 2 },
  { name: 'Quincenal', intervalUnit: 'DAY', intervalValue: 15, order: 3 },
  { name: 'Mensual', intervalUnit: 'MONTH', intervalValue: 1, order: 4 },
] as const;

export async function seedPaymentFrequencies(manager: EntityManager): Promise<void> {
  for (const item of defaults) await manager.query('INSERT INTO "payment_frequencies" ("name", "interval_unit", "interval_value", "display_order", "is_active") VALUES ($1, $2, $3, $4, true) ON CONFLICT ((lower("name"))) DO NOTHING', [item.name, item.intervalUnit, item.intervalValue, item.order]);
}
