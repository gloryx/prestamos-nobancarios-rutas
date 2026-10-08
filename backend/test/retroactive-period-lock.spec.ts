import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RetroactivePeriodTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/retroactive-period.typeorm-reader';

describe('retroactive period transaction locking', () => {
  it('takes the shared advisory transaction lock before reading the latest sealed close', async () => {
    const calls: string[] = [];
    const context = { query: jest.fn(async (sql: string) => { calls.push(sql); return []; }) };
    await new RetroactivePeriodTypeOrmReader({} as never).latestClosedThrough(context as never);
    expect(calls[0]).toContain("pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))");
    expect(calls[1]).toContain('confirmed_at IS NOT NULL');
  });

  it('keeps loan, payment, and refinancing checks on their existing transaction contexts', () => {
    const application = (file: string) => readFileSync(join(__dirname, `../src/application/${file}`), 'utf8');
    expect(application('loan/loan.use-case.ts')).toContain('assertDateAllowed(input.startDate, manager)');
    const payments = application('payment/payment.use-case.ts');
    expect(payments).toContain('assertDateAllowed(input.paymentDate, manager)');
    expect(payments).toContain('assertDateAllowed(effectiveDate, manager)');
    expect(application('loan-refinancing/refinancing.use-case.ts')).toContain('assertDateAllowed(input.refinancingDate, tx.context)');
  });
});
