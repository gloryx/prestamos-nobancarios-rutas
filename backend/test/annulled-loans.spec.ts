import 'reflect-metadata';
import { ListAnnulledLoansUseCase, AnnulledLoansIntegrityError, AnnulledLoansValidationError } from '../src/application/loan/annulled-loans.use-case';
import { AnnulledLoansTypeormReader } from '../src/infrastructure/database/typeorm/repositories/annulled-loans.reader';
import { paymentFingerprint } from '../src/domain/payment/payment-rules';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const dateInCostaRica = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso));
  const value = (part: string) => parts.find((p) => p.type === part)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
type Event = { id: string; sequence: number; kind: string; from: string | null; to: string; at: string; reason: string | null;
  actor: string | null; resolution: string | null };
const event = (n: number, from: string | null = 'ACTIVE', to = 'ANNULLED', at = '2026-09-30T05:59:59.123456Z'): Event =>
  ({ id: id(700 + n), sequence: n, kind: from === null ? 'CREATED' : 'TRANSITION', from, to, at,
    reason: from === null ? null : 'Original reason', actor: id(900), resolution: from === null ? null : 'NOT_DELIVERED' });
const fact = (n: number, status = 'ACTIVE') => ({ loanId: id(n), loanNumber: String(n), status, customerId: id(100 + n),
  identification: `DOC-${n}`, fullName: `Customer ${n}`, primaryPhone: `8888-${n}`, secondaryPhone: `7777-${n}`,
  startDate: '2026-09-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00',
  disbursementId: id(200 + n), disbursementAmount: '100.00', disbursementDate: '2026-09-01', disbursementMethodId: id(300),
  cashId: id(400 + n), cashAmount: '100.00', cashDate: '2026-09-01', cashMethodId: id(300), cashConcept: 'LOAN_DISBURSEMENT', cashDirection: 'OUTFLOW',
  reversalId: id(500 + n), reversalAmount: '100.00', reversalDate: '2026-09-29', reversalMethodId: id(300),
  reversalConcept: 'REVERSAL', reversalDirection: 'INFLOW', payments: [] as string[],
  events: [event(1, null, 'ACTIVE', '2026-09-01T09:00:00.000000Z'), event(2)] });
type Fact = ReturnType<typeof fact>;

function harness(facts: Fact[]) {
  const manager = { query: jest.fn(async (sql: string, params: unknown[]) => {
    if (!sql.startsWith('SELECT') || /\b(?:UPDATE|INSERT|DELETE|FOR UPDATE)\b/i.test(sql)) throw new Error('Reader attempted a write.');
    if (!sql.includes('LEFT JOIN loan_disbursements d ON d.loan_id = l.id') ||
      !sql.includes('reversal.reversed_movement_id = original.id') ||
      !sql.includes('ORDER BY h.event_sequence DESC LIMIT 1') ||
      !sql.includes("event.changed_at AT TIME ZONE 'UTC'") ||
      !sql.includes("event.changed_at AT TIME ZONE 'America/Costa_Rica'") ||
      sql.includes("h.event_kind = 'TRANSITION'")) throw new Error('Reader did not select the causal latest event and linked cash.');
    const annulled = sql.includes("l.status = 'ANNULLED'");
    if (!annulled && !sql.includes("NOT EXISTS (SELECT 1 FROM payments p WHERE p.loan_id = l.id AND p.status = 'VALID')"))
      throw new Error('Candidate filter must exclude only VALID payments.');
    const search = sql.includes('ILIKE') ? String(params[0]).slice(1, -1).toLowerCase() : undefined;
    if (search && !['loan_number::text', 'c.identification', 'c.first_name', 'c.primary_phone', 'c.secondary_phone']
      .every((field) => sql.includes(field))) throw new Error('Reader omitted a search field.');
    return facts.filter((row) => row.status === (annulled ? 'ANNULLED' : 'ACTIVE') &&
      (annulled || !row.payments.includes('VALID')) &&
      (!search || [row.loanNumber, row.identification, row.fullName, row.primaryPhone, row.secondaryPhone]
        .some((field) => field.toLowerCase().includes(search)))).map(({ payments: _payments, events, status: _status,
      primaryPhone: _primary, secondaryPhone: _secondary, ...row }) => {
      const last = events.slice().sort((a, b) => b.sequence - a.sequence)[0];
      const fingerprint = last && last.reason && last.actor && last.resolution ? paymentFingerprint({ operation: 'ANNUL_LOAN',
        loanId: row.loanId, actorId: last.actor, reason: last.reason, disbursementResolution: last.resolution }) : null;
      return { ...row, eventId: last?.id ?? null, eventSequence: last?.sequence ?? null, eventKind: last?.kind ?? null,
        fromStatus: last?.from ?? null, toStatus: last?.to ?? null, annulledAt: last?.at ?? null,
        annulledBusinessDate: last ? dateInCostaRica(last.at) : null, reason: last?.reason ?? null,
        actorId: last?.actor ?? null, disbursementResolution: last?.resolution ?? null, eventFingerprint: fingerprint,
        reversalActorId: id(900), reversalKey: `loan-annulment:${last?.id}`, reversalFingerprint: fingerprint };
    });
  }) };
  const source = { transaction: jest.fn(async (isolation: string, run: (tx: typeof manager) => Promise<unknown>) => {
    expect(isolation).toBe('REPEATABLE READ'); return run(manager);
  }) };
  const list = new ListAnnulledLoansUseCase(new AnnulledLoansTypeormReader(source as never));
  const read = (kind: 'annullable' | 'annulled', filters: Record<string, unknown> = {}) =>
    list.execute(kind, { page: 1, pageSize: 10, ...filters });
  return { read, manager, source };
}

describe('Loan annulment read models', () => {
  it('selects ACTIVE loans without any VALID payment, including one or many ANNULLED payments, and exposes real disbursement', async () => {
    const rows = [fact(1), fact(2), fact(3), fact(4, 'ANNULLED')];
    rows[1].payments.push('ANNULLED'); rows[2].payments.push('ANNULLED', 'ANNULLED'); rows[3].payments.push('VALID');
    const { read, manager } = harness(rows);
    const result = await read('annullable');
    expect(result.items.map((r) => r.loanId)).toEqual([id(3), id(2), id(1)]);
    expect(result.items[0]).toMatchObject({ status: 'ACTIVE', principal: '100.00', interestAmount: '20.00',
      totalAmount: '120.00', disbursement: { id: rows[2].disbursementId, amount: '100.00', date: '2026-09-01' } });
    expect(result.summary).toEqual({ total: 3, capital: '300.00', interest: '60.00', contractualTotal: '360.00' });
    rows[1].payments.push('VALID'); expect((await read('annullable')).total).toBe(2);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('uses the latest event sequence, Costa Rica date under another TZ, and includes structured resolution', async () => {
    const first = fact(1, 'ANNULLED'); first.events[1].at = '2026-09-30T05:59:59.123456Z';
    first.events.push({ ...event(3, 'ANNULLED', 'ACTIVE'), at: '2026-10-02T06:00:00.000001Z' });
    first.events.push({ ...event(4), at: '2026-09-30T06:00:00.000001Z', reason: 'Latest', resolution: 'RETURNED_IN_FULL' });
    first.reversalDate = '2026-09-30';
    const earlier = fact(2, 'ANNULLED'); earlier.reversalDate = '2026-09-29';
    const tz = process.env.TZ; process.env.TZ = 'Pacific/Auckland';
    try {
      const { read } = harness([first, earlier]);
      expect((await read('annulled', { startDate: '2026-09-30', endDate: '2026-09-30' })).items)
        .toMatchObject([{ loanId: id(1), annulledAt: '2026-09-30T06:00:00.000001Z',
          annulledBusinessDate: '2026-09-30', reason: 'Latest', actorId: id(900), disbursementResolution: 'RETURNED_IN_FULL' }]);
      expect((await read('annulled', { endDate: '2026-09-29' })).items).toMatchObject([{ loanId: id(2), annulledBusinessDate: '2026-09-29' }]);
    } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  });

  it.each(['missing', 'wrong-latest', 'older-convenient', 'missing-resolution', 'missing-reversal', 'wrong-cash'])('fails closed for %s before date filtering', async (kind) => {
    const row = fact(1, 'ANNULLED');
    if (kind === 'missing') row.events = [];
    if (kind === 'wrong-latest') row.events.push(event(3, 'CANCELLED'));
    if (kind === 'older-convenient') row.events.push(event(3, 'ANNULLED', 'ACTIVE'));
    if (kind === 'missing-resolution') row.events[1].resolution = null;
    if (kind === 'missing-reversal') row.reversalId = '';
    if (kind === 'wrong-cash') row.reversalAmount = '101.00';
    await expect(harness([row]).read('annulled', { startDate: '2028-01-01' })).rejects.toBeInstanceOf(AnnulledLoansIntegrityError);
  });

  it('searches number, identity, full name and both phones, and uses start date for candidates', async () => {
    const a = fact(1); a.fullName = 'Ana Maria Soto'; a.identification = 'SPECIAL-1';
    const b = fact(2); b.startDate = b.disbursementDate = b.cashDate = '2026-09-02';
    const { read, manager } = harness([a, b]);
    for (const search of ['1', 'special-1', 'ana maria', '8888-1', '7777-1']) {
      expect((await read('annullable', { search: `  ${search}  ` })).total).toBe(1);
      expect(manager.query.mock.calls.at(-1)?.[1]).toEqual([`%${search}%`]);
    }
    expect((await read('annullable', { startDate: '2026-09-02' })).items).toMatchObject([{ loanId: id(2) }]);
    expect((await read('annullable', { endDate: '2026-09-01' })).items).toMatchObject([{ loanId: id(1) }]);
  });

  it.each(['annullable', 'annulled'] as const)('sorts and pages %s on the server, with full-set exact-cent summaries', async (kind) => {
    const rows = Array.from({ length: 30 }, (_, n) => fact(n + 1, kind === 'annulled' ? 'ANNULLED' : 'ACTIVE'));
    rows.forEach((r, n) => { r.principal = `${n + 1}00.00`; r.disbursementAmount = r.cashAmount = r.reversalAmount = r.principal;
      r.totalAmount = `${n + 1}00.20`; r.interestAmount = '0.20'; });
    const { read, manager } = harness(rows);
    const second = await read(kind, { page: 2 });
    expect(second.items).toHaveLength(10); expect(second.total).toBe(30);
    expect(second.summary).toEqual({ total: 30, capital: '46500.00', interest: '6.00', contractualTotal: '46506.00' });
    expect((await read(kind, { page: 4 })).items).toEqual([]);
    for (const sortBy of ['loanNumber', 'customer', 'startDate', 'principal', 'interest', 'contractualTotal',
      ...(kind === 'annulled' ? ['annulledDate'] : [])]) {
      expect((await read(kind, { sortBy, sortDir: 'asc' })).items).toHaveLength(10);
      expect((await read(kind, { sortBy, sortDir: 'desc' })).items).toHaveLength(10);
    }
    expect((await read(kind, { sortBy: 'principal', sortDir: 'asc' })).items[0].loanId).toBe(id(1));
    expect((await read(kind, { sortBy: 'principal', sortDir: 'desc' })).items[0].loanId).toBe(id(30));
    expect(manager.query).toHaveBeenCalledTimes(kind === 'annulled' ? 18 : 16);
  });

  it('rejects invalid date, sort, page and monetary/cash corruption', async () => {
    const row = fact(1); const { read, manager } = harness([row]);
    for (const query of [{ startDate: '2026-02-30' }, { endDate: '2025-02-29' },
      { startDate: '2026-10-01', endDate: '2026-09-01' }, { sortBy: 'annulledDate' },
      { sortBy: 'l.id' }, { page: 0 }, { pageSize: 100 }, { page: Number.MAX_SAFE_INTEGER }])
      await expect(read('annullable', query)).rejects.toBeInstanceOf(AnnulledLoansValidationError);
    expect(manager.query).not.toHaveBeenCalled();
    row.disbursementAmount = '99.00';
    await expect(read('annullable')).rejects.toBeInstanceOf(AnnulledLoansIntegrityError);
  });
});
