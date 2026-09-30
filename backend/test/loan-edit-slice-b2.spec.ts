import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LoanEditDto } from '../src/presentation/loan/loan.dto';
import { loanEditBaselineMatches, loanEditFingerprint, LoanEditInputError, normalizeLoanEditCommand, normalizeLoanEditSnapshot } from '../src/application/loan/loan-edit.command';
import type { LoanEditInput } from '../src/domain/loan/loan-edit.types';

const loan = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const frequency = '33333333-3333-4333-8333-333333333333';
const method = '44444444-4444-4444-8444-444444444444';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const baseline = () => ({ interestAmount: '20.00', paymentFrequencyId: frequency, preferredPaymentMethodId: method,
  observations: ' ORIGINAL ', financialBalance: '120.00', plan: [
    { id: first, dueDate: '2026-10-01', pendingAmount: '70.00' },
    { id: second, dueDate: '2026-11-01', pendingAmount: '50.00' },
  ] });
const body = () => ({ idempotencyKey: 'edit-1', baseline: baseline(), changes: { interestAmount: '30.00', observations: '  Updated note  ' },
  plan: [{ id: first, dueDate: '2026-10-01', pendingAmount: '80.00' }, { id: null as string | null, dueDate: '2026-12-01', pendingAmount: '50.00' }] });
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: LoanEditDto });
const command = (value: LoanEditInput = body()) => normalizeLoanEditCommand(value, loan, actor);

describe('unpublished loan edit DTO under the real global ValidationPipe policy', () => {
  it('accepts a complete draft and metadata-only edits without a plan', async () => {
    expect(await validate(body())).toBeInstanceOf(LoanEditDto);
    const metadata = { idempotencyKey: '!', baseline: baseline(), changes: { observations: null } };
    expect(await validate(metadata)).toMatchObject(metadata);
    expect(await validate({ ...metadata, changes: { interestAmount: '25' } })).toMatchObject({ changes: { interestAmount: '25' } });
    expect(await validate({ ...metadata, plan: [] })).toMatchObject({ plan: [] });
    expect(await validate({ ...metadata, changes: { observations: '   ' } })).toMatchObject({ changes: { observations: '   ' } });
  });

  it.each(['principal', 'startDate', 'status', 'customerId', 'loanNumber', 'createdByUserId', 'totalAmount', 'actorId', 'loanId'])
  ('rejects forbidden top-level %s instead of whitelisting it away', async (field) => {
    await expect(validate({ ...body(), [field]: 'untrusted' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['changes', 'principal'], ['changes', 'startDate'], ['changes', 'totalAmount'], ['changes', 'createdByUserId'],
    ['baseline', 'customerId'], ['baseline', 'updatedAt'], ['baseline.plan', 'sequence'], ['plan', 'loanId'],
  ])('rejects forbidden %s.%s', async (location, field) => {
    const input = body();
    if (location === 'changes') Object.assign(input.changes, { [field]: 'bad' });
    if (location === 'baseline') Object.assign(input.baseline, { [field]: 'bad' });
    if (location === 'baseline.plan') Object.assign(input.baseline.plan[0], { [field]: 'bad' });
    if (location === 'plan') Object.assign(input.plan[0], { [field]: 'bad' });
    await expect(validate(input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty changes, plan-only drafts, missing baseline and null optional reference', async () => {
    await expect(validate({ ...body(), changes: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), changes: { observations: undefined } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ idempotencyKey: 'edit', baseline: baseline(), plan: body().plan, changes: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ idempotencyKey: 'edit', changes: { observations: null } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), changes: { preferredPaymentMethodId: null } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), plan: null })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['', 'with space', 'with\nnewline', 'x'.repeat(129), null])('rejects malformed idempotency key %s', async (key) => {
    await expect(validate({ ...body(), idempotencyKey: key })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['not-a-uuid', '', 123])('rejects invalid required UUID %s', async (id) => {
    await expect(validate({ ...body(), baseline: { ...baseline(), paymentFrequencyId: id } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), plan: [{ ...body().plan[0], id }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a baseline UUID but permits a null ID only for a new draft row', async () => {
    await expect(validate({ ...body(), baseline: { ...baseline(), plan: [{ ...baseline().plan[0], id: null }] } })).rejects.toBeInstanceOf(BadRequestException);
    expect(await validate({ ...body(), plan: [{ ...body().plan[0], id: null }] })).toMatchObject({ plan: [{ id: null }] });
  });

  it.each(['-1', 'NaN', 'Infinity', '1.234', '01.00', '1e3', 1, null])('rejects invalid money %s', async (amount) => {
    await expect(validate({ ...body(), changes: { interestAmount: amount } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), baseline: { ...baseline(), financialBalance: amount } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), plan: [{ ...body().plan[0], pendingAmount: amount }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '2026-10-01T00:00:00Z'])
  ('rejects non-calendar or non-date-only day %s in either plan', async (dueDate) => {
    await expect(validate({ ...body(), baseline: { ...baseline(), plan: [{ ...baseline().plan[0], dueDate }] } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...body(), plan: [{ ...body().plan[0], dueDate }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates baseline row identity and positive amounts at the pure boundary, not only the DTO', async () => {
    const duplicate = { ...body(), baseline: { ...baseline(), plan: [baseline().plan[0], baseline().plan[0]] } };
    const nullId = { ...body(), baseline: { ...baseline(), plan: [{ ...baseline().plan[0], id: null }] } };
    const zero = { ...body(), baseline: { ...baseline(), plan: [{ ...baseline().plan[0], pendingAmount: '0' }] } };
    await expect(validate(nullId)).rejects.toBeInstanceOf(BadRequestException);
    for (const input of [duplicate, zero]) {
      await expect(validate(input)).rejects.toBeInstanceOf(BadRequestException);
      expect(() => command(input as LoanEditInput)).toThrow(LoanEditInputError);
    }
    expect(() => command({ ...body(), plan: [{ ...body().plan[0], pendingAmount: '0' }] })).toThrow(LoanEditInputError);
    expect(() => command({ ...body(), plan: [{ ...body().plan[0], id: first.toUpperCase() }, { ...body().plan[0], id: first }] })).toThrow(LoanEditInputError);
    expect(() => command({ ...body(), changes: {} })).toThrow(LoanEditInputError);
  });
});

describe('loan edit canonical command and pure locked-snapshot comparison', () => {
  it('keeps optional values distinct and computes exact bigint cents without serializing bigint', () => {
    const normalized = command({ ...body(), baseline: { ...baseline(), interestAmount: '9999999999999999.99' }, changes: { interestAmount: '30', observations: '   ' } });
    expect(normalized.baseline.interestAmount).toBe(999999999999999999n);
    expect(normalized.baseline.financialBalance).toBe(12000n);
    expect(normalized.plan?.map((entry) => entry.pendingAmount)).toEqual([8000n, 5000n]);
    expect(normalized.changes).toEqual({ interestAmount: 3000n, observations: null });
    expect(normalized.baseline.observations).toBe('ORIGINAL');
    expect(normalized.plan?.[1].id).toBeNull();
    expect(loanEditFingerprint(normalized)).toMatch(/^[a-f0-9]{64}$/);
    const omitted = command({ idempotencyKey: 'edit', baseline: { ...baseline(), observations: ' ' }, changes: { paymentFrequencyId: frequency } });
    expect(omitted.baseline.observations).toBeNull();
    expect(omitted.changes.observations).toBeUndefined();
    expect(omitted.plan).toBeUndefined();
  });

  it('matches identical positive rows regardless of order, zero rows, timestamps, case or display money', () => {
    const normalized = command({ idempotencyKey: 'key', changes: { observations: null }, baseline: baseline() }).baseline;
    const snapshot = { ...baseline(), interestAmount: '20', financialBalance: '120.0', observations: '  original  ',
      paymentFrequencyId: frequency.toUpperCase(), plan: [...baseline().plan].reverse().concat({ id: loan, dueDate: '2026-12-02', pendingAmount: '0' }), updatedAt: new Date() };
    expect(normalizeLoanEditSnapshot(snapshot).plan).toHaveLength(2);
    expect(loanEditBaselineMatches(normalized, snapshot)).toBe(true);
    expect(loanEditBaselineMatches(normalized, { ...snapshot, plan: snapshot.plan.map((entry) => ({ ...entry, dueDate: new Date(Number(entry.dueDate.slice(0, 4)), Number(entry.dueDate.slice(5, 7)) - 1, Number(entry.dueDate.slice(8, 10))) })) })).toBe(true);
  });

  it('detects changed metadata, balance, and added, removed, repriced or rescheduled positive row IDs', () => {
    const expected = command().baseline;
    for (const changed of [
      { interestAmount: '21' }, { paymentFrequencyId: actor }, { preferredPaymentMethodId: actor },
      { observations: null }, { financialBalance: '119.99' },
      { plan: [baseline().plan[0]] },
      { plan: [...baseline().plan, { id: loan, dueDate: '2026-12-01', pendingAmount: '1' }] },
      { plan: [{ ...baseline().plan[0], id: loan }, baseline().plan[1]] },
      { plan: [{ ...baseline().plan[0], dueDate: '2026-10-02' }, baseline().plan[1]] },
      { plan: [{ ...baseline().plan[0], pendingAmount: '70.01' }, baseline().plan[1]] },
    ]) expect(loanEditBaselineMatches(expected, { ...baseline(), ...changed })).toBe(false);
    expect(loanEditBaselineMatches(expected, { ...baseline(), plan: [baseline().plan[0], baseline().plan[0]] })).toBe(false);
  });
});

describe('explicit stable loan edit SHA-256 fingerprint', () => {
  it('ignores object insertion order, irrelevant plan order, UUID case, equivalent money and normalized observations', () => {
    const original = command();
    const reordered: LoanEditInput = { plan: [...body().plan].reverse().map((row) => ({ ...row, id: row.id?.toUpperCase() ?? null, pendingAmount: row.pendingAmount.replace('.00', '') })),
      changes: { observations: 'updated NOTE', interestAmount: '30' },
      baseline: { ...baseline(), plan: [...baseline().plan].reverse(), observations: 'original', interestAmount: '20', financialBalance: '120', paymentFrequencyId: frequency.toUpperCase() },
      idempotencyKey: 'different-valid-key' };
    expect(loanEditFingerprint(normalizeLoanEditCommand(reordered, loan.toUpperCase(), actor.toUpperCase()))).toBe(loanEditFingerprint(original));
    expect(original.plan?.[0].id).toBe(first);
    expect(normalizeLoanEditCommand(reordered, loan, actor).plan?.[0].id).toBeNull();
  });

  it('distinguishes changes, omission from null, plan omission from empty, identity, and baseline changes', () => {
    const base = { idempotencyKey: 'edit', baseline: baseline(), changes: { observations: null } };
    const hash = (input: LoanEditInput, id = loan, user = actor) => loanEditFingerprint(normalizeLoanEditCommand(input, id, user));
    const original = hash(base);
    for (const [input, id, user] of [
      [{ ...base, changes: { observations: 'value' } }, loan, actor],
      [{ ...base, changes: { interestAmount: '20' } }, loan, actor],
      [{ ...base, changes: { interestAmount: '21', observations: null } }, loan, actor],
      [{ ...base, changes: { observations: null }, plan: [] }, loan, actor],
      [base, method, actor], [base, loan, method],
      [{ ...base, baseline: { ...baseline(), financialBalance: '119' } }, loan, actor],
      [{ ...base, baseline: { ...baseline(), plan: [baseline().plan[0]] } }, loan, actor],
    ] as Array<[LoanEditInput, string, string]>) expect(hash(input, id, user)).not.toBe(original);
    expect(hash({ ...base, changes: { paymentFrequencyId: frequency } })).not.toBe(hash({ ...base, changes: { paymentFrequencyId: frequency, observations: null } }));
    expect(hash({ ...base, changes: { interestAmount: '20' } })).not.toBe(hash({ ...base, changes: { interestAmount: '20', observations: null } }));
    expect(hash({ ...base, baseline: { ...baseline(), observations: null } })).not.toBe(original);
  });
});
