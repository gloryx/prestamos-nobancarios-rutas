import type { EntityManager } from 'typeorm';
import type { LoanEditIdentity, LoanEditReceipt } from '../../../../domain/loan/loan-edit.types';

type TransactionManager = Pick<EntityManager, 'query'>;
type Row = LoanEditReceipt & { actorId: string; fingerprint: string };
const columns = 'id AS "operationId", loan_id AS "loanId", created_by_user_id AS "actorId", idempotency_fingerprint AS "fingerprint", created_at AS "createdAt"';
const receipt = ({ operationId, loanId, createdAt }: Row): LoanEditReceipt => ({ operationId, loanId, createdAt });

export class LoanEditIdempotencyConflictError extends Error {}
export class LoanEditIdempotencyInputError extends Error {}

function check(input: LoanEditIdentity): void {
  if (!input || !/^[\x21-\x7e]{1,128}$/.test(input.idempotencyKey) || !/^[0-9a-f]{64}$/.test(input.fingerprint)) {
    throw new LoanEditIdempotencyInputError('La clave o la huella de la edición no son válidas.');
  }
}

// Both operations must use the same caller-owned transaction as the future edit.
export class LoanEditOperationsRepository {
  async findReplay(manager: TransactionManager, input: LoanEditIdentity): Promise<LoanEditReceipt | undefined> {
    check(input);
    const rows: Row[] = await manager.query(`SELECT ${columns} FROM loan_edit_operations WHERE idempotency_key = $1`, [input.idempotencyKey]);
    const old = rows[0];
    if (!old) return undefined;
    if (old.loanId.toLowerCase() !== input.loanId.toLowerCase() || old.actorId.toLowerCase() !== input.actorId.toLowerCase()
      || old.fingerprint !== input.fingerprint) throw new LoanEditIdempotencyConflictError('La clave de idempotencia ya fue utilizada con otros datos.');
    return receipt(old);
  }

  // Claim before any edit in the same transaction; a losing claim must abort that transaction.
  async claim(manager: TransactionManager, input: LoanEditIdentity): Promise<LoanEditReceipt> {
    check(input);
    const rows: Row[] = await manager.query(`INSERT INTO loan_edit_operations (loan_id, created_by_user_id, idempotency_key, idempotency_fingerprint)
      VALUES ($1,$2,$3,$4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${columns}`,
    [input.loanId, input.actorId, input.idempotencyKey, input.fingerprint]);
    if (!rows[0]) throw new LoanEditIdempotencyConflictError('La clave de idempotencia ya fue utilizada. Reintente la solicitud.');
    return receipt(rows[0]);
  }
}
