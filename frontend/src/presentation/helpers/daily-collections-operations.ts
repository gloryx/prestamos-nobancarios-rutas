import type { DailyCollectionsController } from '../../application/use-cases/daily-collections-controller';
import { loanApi } from '../../infrastructure/api/loan.api';
import { paymentApi, type PlanBaseline } from '../../infrastructure/api/payment.api';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import { persistPlanAndRefresh, reviewPlanDraft, type PlanDraftEntry } from './payment-plan';

export async function downloadDailyPlan(loanId: string, api: Pick<typeof loanApi, 'detail'> = loanApi,
  report: typeof generateLoanPaymentPlanReport = generateLoanPaymentPlanReport) {
  await report(await api.detail(loanId));
}
export async function saveDailyPlan(loanId: string, base: PlanBaseline, draft: PlanDraftEntry[], key: string,
  controller: DailyCollectionsController, api: Pick<typeof paymentApi, 'customizePlan' | 'context'> = paymentApi) {
  const review = reviewPlanDraft(base.financialBalance, draft);
  if (!review.canSave) throw new Error('Revisa las fechas, los montos y el saldo distribuido.');
  await persistPlanAndRefresh(loanId, base, review.entries, key, api);
  await controller.load();
}
