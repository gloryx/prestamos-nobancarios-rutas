import type { EntityManager } from 'typeorm';
import { getNextLoanStatusEventSequence, LoanStatusHistorySequenceError } from '../src/application/loan/loan-status-history-sequence';

const sql = 'SELECT MAX(event_sequence) AS "maxSequence" FROM loan_status_history WHERE loan_id = $1';

function historyManager(history: Record<string, number[]>) {
  const query = jest.fn(async (statement: string, params: unknown[]) => {
    if (statement !== sql) throw new Error(`Unexpected query: ${statement}`);
    const sequences = history[params[0] as string] ?? [];
    return [{ maxSequence: sequences.length ? Math.max(...sequences) : null }];
  });
  return { manager: { query } as unknown as Pick<EntityManager, 'query'>, query };
}

describe('loan status history event sequence', () => {
  it.each([
    ['no events', [], 1],
    ['CREATED', [1], 2],
    ['a gap', [1, 2, 4], 5],
  ] as const)('returns the next sequence for %s with one scoped SELECT', async (_, events, expected) => {
    const { manager, query } = historyManager({ 'loan-a': [...events] });
    await expect(getNextLoanStatusEventSequence(manager, 'loan-a')).resolves.toBe(expected);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(sql, ['loan-a']);
  });

  it('isolates loans when the same manager serves both', async () => {
    const { manager, query } = historyManager({ 'loan-a': [1], 'loan-b': [1, 2, 4] });
    await expect(getNextLoanStatusEventSequence(manager, 'loan-a')).resolves.toBe(2);
    await expect(getNextLoanStatusEventSequence(manager, 'loan-b')).resolves.toBe(5);
    expect(query.mock.calls).toEqual([[sql, ['loan-a']], [sql, ['loan-b']]]);
  });

  it.each([
    ['missing aggregate row', []],
    ['missing maximum', [{}]],
    ['string maximum', [{ maxSequence: '1' }]],
    ['zero', [{ maxSequence: 0 }]],
    ['fraction', [{ maxSequence: 1.5 }]],
    ['negative', [{ maxSequence: -1 }]],
    ['integer overflow', [{ maxSequence: 2147483647 }]],
    ['unsafe integer', [{ maxSequence: Number.MAX_SAFE_INTEGER + 1 }]],
  ])('rejects %s with a typed error', async (_, rows) => {
    const query = jest.fn().mockResolvedValue(rows);
    await expect(getNextLoanStatusEventSequence({ query } as unknown as Pick<EntityManager, 'query'>, 'loan-a'))
      .rejects.toThrow(LoanStatusHistorySequenceError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(sql, ['loan-a']);
  });
});
