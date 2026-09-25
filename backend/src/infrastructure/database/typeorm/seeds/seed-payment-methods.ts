import { EntityManager } from 'typeorm';
const defaults = [{ name: 'Efectivo', order: 1 }, { name: 'SINPE Móvil', order: 2 }, { name: 'Transferencia', order: 3 }];
export async function seedPaymentMethods(manager: EntityManager): Promise<void> {
  for (const item of defaults) await manager.query('INSERT INTO "payment_methods" ("name", "display_order", "is_active") VALUES ($1, $2, true) ON CONFLICT ((lower("name"))) DO NOTHING', [item.name, item.order]);
}
