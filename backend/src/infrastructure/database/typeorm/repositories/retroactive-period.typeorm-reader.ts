import type { DataSource, EntityManager } from 'typeorm';
import type { RetroactivePeriodReader } from '../../../../application/financial-close/retroactive-period.guard';

export class RetroactivePeriodTypeOrmReader implements RetroactivePeriodReader {
  constructor(private readonly source: DataSource) {}
  async latestClosedThrough(context?: unknown): Promise<string | null> {
    const executor = context && typeof (context as EntityManager).query === 'function' ? context as EntityManager : this.source;
    if (context) await executor.query(`SELECT pg_advisory_xact_lock_shared(hashtext('financial-closes-v2'))`);
    const [row] = await executor.query(`SELECT to_date::text AS "toDate" FROM financial_closes
      WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
    return row?.toDate ?? null;
  }
}
