import { formatCRC } from "../../shared/utils/money";

export type LoanConfirmationSummaryInput = {
  principal: string;
  interestAmount: string;
  total: string;
  planCount: number;
  disbursementMethod: string;
};

export function getLoanConfirmationSummary(input: LoanConfirmationSummaryInput) {
  return [
    ["Capital", formatCRC(input.principal)],
    ["Interés", formatCRC(input.interestAmount)],
    ["Total a pagar", formatCRC(input.total)],
    ["Cuotas programadas", String(input.planCount)],
    ["Forma de desembolso", input.disbursementMethod || "—"],
    ["Desembolso real", formatCRC(input.principal)],
  ] as const;
}

export function getLoanCreatedToastMessage(loanNumber: string | number): string {
  return `Préstamo #${loanNumber} creado correctamente.`;
}
