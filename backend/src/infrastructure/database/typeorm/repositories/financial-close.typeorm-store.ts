import type { DataSource, EntityManager } from 'typeorm';
import type { FinancialCloseCalculation } from '../../../../domain/financial-close/financial-close';
import type { FinancialCloseRecord, FinancialCloseSourceSnapshot, FinancialCloseStore, FinancialCloseTransaction } from '../../../../application/financial-close/financial-close.store';
import { EconomicCapitalTypeOrmReader } from './economic-capital.reader';

type HeaderRow = { id: string; period: string; sequence: number; modelVersion: number; fromDate: string; toDate: string;
  integrityStatus: 'COMPLETE' | 'INCONSISTENT'; blockingIssues: string[]; warnings: string[]; confirmedAt: Date;
  confirmedById: string; confirmedByName: string };
type ConceptRow = { financialCloseId: string; section: FinancialCloseCalculation['sections'][number]['code']; code: string; label: string;
  classification: 'OPERATING' | 'FINANCING' | 'EXTERNAL_NON_OPERATING' | 'BALANCE' | 'CONTROL' | 'RESULT'; amount: string; ordinal: number };

export class FinancialCloseTypeOrmStore implements FinancialCloseStore {
  private readonly economicReader: EconomicCapitalTypeOrmReader;
  constructor(private readonly source: DataSource) { this.economicReader = new EconomicCapitalTypeOrmReader(source); }

  private async sourceSnapshot(manager: EntityManager, fromDate: string, toDate: string): Promise<FinancialCloseSourceSnapshot> {
    const [opening] = await manager.query(`SELECT opening_date::text AS "openingDate", initial_available_amount::text AS "initialAvailableAmount",
      initial_portfolio::text AS "initialPortfolio", initial_uncollectible_amount::text AS "initialUncollectibleAmount"
      FROM financial_openings WHERE singleton_key = 'DEFAULT'`);
    const effectiveFromDate = opening && opening.openingDate > fromDate && opening.openingDate <= toDate ? opening.openingDate : fromDate;
    const economic = await this.economicReader.readDetailedSnapshot(manager, toDate);
    const previousDate = new Date(new Date(`${effectiveFromDate}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const openingEconomic = opening && previousDate >= opening.openingDate
      ? await this.economicReader.readDetailedSnapshot(manager, previousDate) : null;
    const cashFacts = await manager.query(`SELECT movement.direction, movement.concept, movement.amount::text AS amount,
      movement.movement_date::text AS date, original.concept AS "reversedConcept"
      FROM cash_movements movement LEFT JOIN cash_movements original ON original.id = movement.reversed_movement_id
      WHERE movement.movement_date BETWEEN $1::date AND $2::date ORDER BY movement.movement_date, movement.created_at, movement.id`,
    [effectiveFromDate, toDate]);
    const [cashBalances] = await manager.query(`SELECT
      (opening.initial_available_amount + COALESCE(SUM(CASE WHEN movement.movement_date < $1::date
        THEN CASE WHEN movement.direction = 'INFLOW' THEN movement.amount ELSE -movement.amount END ELSE 0 END),0))::text AS opening,
      (opening.initial_available_amount + COALESCE(SUM(CASE WHEN movement.movement_date <= $2::date
        THEN CASE WHEN movement.direction = 'INFLOW' THEN movement.amount ELSE -movement.amount END ELSE 0 END),0))::text AS closing
      FROM financial_openings opening LEFT JOIN cash_movements movement ON true
      WHERE opening.singleton_key = 'DEFAULT' GROUP BY opening.initial_available_amount`, [effectiveFromDate, toDate]);
    const statusTransitions = await manager.query(`SELECT loan_id AS "loanId", from_status AS "fromStatus", to_status AS "toStatus",
      (changed_at AT TIME ZONE 'America/Costa_Rica')::date::text AS date FROM loan_status_history
      WHERE (changed_at AT TIME ZONE 'America/Costa_Rica')::date BETWEEN $1::date AND $2::date
      ORDER BY changed_at, event_sequence, id`, [effectiveFromDate, toDate]);
    return { capitalFacts: economic.capitalFacts, provenance: economic.provenance, loans: economic.loans,
      economicFacts: economic.economicFacts, opening: opening ?? null, effectiveFromDate,
      openingEconomic: openingEconomic ? { provenance: openingEconomic.provenance, facts: openingEconomic.economicFacts } : null,
      cashFacts, cashBalances: cashBalances ?? { opening: opening?.initialAvailableAmount ?? '0.00', closing: opening?.initialAvailableAmount ?? '0.00' },
      statusTransitions };
  }
  previewSource(fromDate: string, toDate: string) { return this.source.transaction('REPEATABLE READ', (manager) => this.sourceSnapshot(manager, fromDate, toDate)); }
  async nextSequence() { return this.nextSequenceWith(this.source.manager); }
  private async nextSequenceWith(manager: Pick<EntityManager, 'query'>) {
    const [latest] = await manager.query(`SELECT sequence, period FROM financial_closes WHERE confirmed_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`);
    if (!latest) return { sequence: 1, expectedPeriod: null };
    const [year, month] = String(latest.period).split('-').map(Number);
    return { sequence: Number(latest.sequence) + 1, expectedPeriod: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7) };
  }
  confirm<T>(work: (transaction: FinancialCloseTransaction) => Promise<T>): Promise<T> {
    return this.source.transaction('SERIALIZABLE', (manager) => work({
      lock: async () => { await manager.query(`SELECT pg_advisory_xact_lock(hashtext('financial-closes-v2'))`); },
      nextSequence: () => this.nextSequenceWith(manager),
      source: (fromDate, toDate) => this.sourceSnapshot(manager, fromDate, toDate),
      insert: (calculation, sequence, actorId) => this.insert(manager, calculation, sequence, actorId),
    }));
  }
  private async insert(manager: EntityManager, calculation: FinancialCloseCalculation, sequence: number, actorId: string) {
    const [header] = await manager.query(`INSERT INTO financial_closes
      (period, sequence, model_version, from_date, to_date, integrity_status, blocking_issues, warnings, confirmed_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING id`, [calculation.period, sequence, calculation.modelVersion,
      calculation.fromDate, calculation.toDate, calculation.integrity.status, JSON.stringify(calculation.integrity.blockingIssues),
      JSON.stringify(calculation.integrity.warnings), actorId]);
    for (const detail of calculation.sections.flatMap((section) => section.concepts)) await manager.query(`INSERT INTO financial_close_concepts
      (financial_close_id, section, code, label, classification, amount, ordinal) VALUES ($1,$2,$3,$4,$5,$6::numeric(38,2),$7)`,
    [header.id, detail.section, detail.code, detail.label, detail.classification, detail.amount, detail.ordinal]);
    const [sealed] = await manager.query(`UPDATE financial_closes SET confirmed_at = clock_timestamp()
      WHERE id = $1 AND confirmed_at IS NULL RETURNING confirmed_at AS "confirmedAt"`, [header.id]);
    if (!sealed) throw new Error('Financial close snapshot could not be sealed.');
    return (await this.findByIdWith(manager, header.id))!;
  }
  async list(page: number, pageSize: 10 | 20 | 50) {
    const offset = (page - 1) * pageSize;
    const headers = await this.source.query(this.headerSql() + ` ORDER BY fc.sequence DESC LIMIT $1 OFFSET $2`, [pageSize, offset]);
    const [{ total }] = await this.source.query(`SELECT COUNT(*)::int AS total FROM financial_closes WHERE confirmed_at IS NOT NULL`);
    return { items: await this.hydrate(this.source.manager, headers), total };
  }
  findById(id: string) { return this.findByIdWith(this.source.manager, id); }
  private async findByIdWith(manager: Pick<EntityManager, 'query'>, id: string) {
    const rows = await manager.query(this.headerSql() + ` AND fc.id = $1`, [id]);
    return (await this.hydrate(manager, rows))[0] ?? null;
  }
  private headerSql() { return `SELECT fc.id, fc.period, fc.sequence, fc.model_version AS "modelVersion", fc.from_date::text AS "fromDate",
    fc.to_date::text AS "toDate", fc.integrity_status AS "integrityStatus", fc.blocking_issues AS "blockingIssues", fc.warnings,
    fc.confirmed_at AS "confirmedAt", u.id AS "confirmedById", u.full_name AS "confirmedByName"
    FROM financial_closes fc JOIN users u ON u.id = fc.confirmed_by_user_id WHERE fc.confirmed_at IS NOT NULL`; }
  private async hydrate(manager: Pick<EntityManager, 'query'>, headers: HeaderRow[]): Promise<FinancialCloseRecord[]> {
    if (!headers.length) return [];
    const details: ConceptRow[] = await manager.query(`SELECT financial_close_id AS "financialCloseId", section, code, label, classification,
      amount::text AS amount, ordinal FROM financial_close_concepts WHERE financial_close_id = ANY($1::uuid[]) ORDER BY ordinal`, [headers.map((row) => row.id)]);
    return headers.map((header) => { const concepts = details.filter((detail) => detail.financialCloseId === header.id);
      const sectionCodes = ['LIQUIDITY', 'CONTRACTUAL_PORTFOLIO', 'ECONOMIC_CAPITAL', 'REFINANCINGS', 'PROFITABILITY', 'RECONCILIATIONS'] as const;
      return { id: header.id, period: header.period, sequence: header.sequence, modelVersion: header.modelVersion, fromDate: header.fromDate, toDate: header.toDate,
        integrity: { status: header.integrityStatus, blockingIssues: header.blockingIssues, warnings: header.warnings },
        sections: sectionCodes.map((code) => ({ code, concepts: concepts.filter((item) => item.section === code).map((item) => ({
          section: item.section, code: item.code, label: item.label, classification: item.classification, amount: item.amount, ordinal: item.ordinal })) })),
        confirmedAt: header.confirmedAt, confirmedBy: { id: header.confirmedById, fullName: header.confirmedByName } };
    });
  }
}
