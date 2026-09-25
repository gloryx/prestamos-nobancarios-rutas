import { costaRicaDta2026Cantons, costaRicaDta2026Districts, costaRicaDta2026Provinces } from './data/costa-rica-dta-2026.data';
import { seedCostaRicaDta2026 } from './seed-dta-2026';
import { validateDta2026 } from './validation';
import { seedPaymentMethods } from './seed-payment-methods';
import { seedPaymentFrequencies } from './seed-payment-frequencies';
import { seedSecurity } from './seed-security';

async function run(): Promise<void> {
  validateDta2026({ provinces: costaRicaDta2026Provinces, cantons: costaRicaDta2026Cantons, districts: costaRicaDta2026Districts });
  const { appDataSource } = await import('../data-source');
  await appDataSource.initialize();
  try {
      await appDataSource.transaction(async (manager) => { await seedCostaRicaDta2026(manager); await seedPaymentMethods(manager); await seedPaymentFrequencies(manager); await seedSecurity(manager); });
  } finally {
    await appDataSource.destroy();
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
