export type CollectorStatisticsPeriod = {
  year: number;
  month: number | null;
  startDate: string;
  endDate: string;
  granularity: 'MONTH' | 'DAY';
};

export type CollectorStatisticsSummaryFacts = {
  totalCollectors: number;
  activeCollectors: number;
  inactiveCollectors: number;
  collectorsWithValidPayments: number;
  collectorsWithoutValidPayments: number;
  activeCollectorsWithoutValidPayments: number;
  linkedCollectors: number;
  unlinkedCollectors: number;
  validPaymentsCount: number;
  totalCollectedAmount: string;
  principalAppliedAmount: string;
  interestAppliedAmount: string;
  averageValidPaymentAmount: string;
  annulledPaymentsCount: number;
  annulledAmount: string;
};

export type CollectorStatisticsRow = {
  collectorId: string;
  identification: string;
  fullName: string;
  isActive: boolean;
  userLinked: boolean;
  validPaymentsCount: number;
  totalCollectedAmount: string;
  principalAppliedAmount: string;
  interestAppliedAmount: string;
  averageValidPaymentAmount: string;
  annulledPaymentsCount: number;
  annulledAmount: string;
  currentActiveRoutes: number;
  currentAssignedActiveCustomers: number;
};

export type CollectorPaymentMethodStatistics = {
  paymentMethodId: string;
  name: string;
  currentlyActive: boolean;
  validPaymentsCount: number;
  totalCollectedAmount: string;
};

export type CollectorStatisticsEvolution = {
  period: string;
  validPaymentsCount: number;
  totalCollectedAmount: string;
  annulledPaymentsCount: number;
  annulledAmount: string;
};

export type UnattributedPaymentStatistics = {
  validPaymentsCount: number;
  totalCollectedAmount: string;
  annulledPaymentsCount: number;
  annulledAmount: string;
};

export type CollectorStatisticsFacts = {
  summary: CollectorStatisticsSummaryFacts;
  byCollector: CollectorStatisticsRow[];
  paymentMethods: CollectorPaymentMethodStatistics[];
  evolution: CollectorStatisticsEvolution[];
  unattributedPayments: UnattributedPaymentStatistics;
};

export class CollectorStatisticsIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectorStatisticsIntegrityError';
  }
}

const moneyPattern = /^(?:0|[1-9]\d*)\.\d{2}$/;
const count = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new CollectorStatisticsIntegrityError(`El conteo ${field} no es válido.`);
};
const money = (value: string, field: string): void => {
  if (!moneyPattern.test(value))
    throw new CollectorStatisticsIntegrityError(`El monto ${field} no es válido.`);
};
const cents = (value: string): bigint => BigInt(value.replace('.', ''));
const sumMoney = (values: string[]): bigint => values.reduce((total, value) => total + cents(value), 0n);

export function buildCollectorStatistics(period: CollectorStatisticsPeriod, facts: CollectorStatisticsFacts) {
  for (const [field, value] of Object.entries(facts.summary)) {
    if (typeof value === 'number') count(value, `summary.${field}`);
    else money(value, `summary.${field}`);
  }
  for (const row of facts.byCollector) {
    for (const field of ['validPaymentsCount', 'annulledPaymentsCount', 'currentActiveRoutes',
      'currentAssignedActiveCustomers'] as const) count(row[field], `byCollector.${field}`);
    for (const field of ['totalCollectedAmount', 'principalAppliedAmount', 'interestAppliedAmount',
      'averageValidPaymentAmount', 'annulledAmount'] as const) money(row[field], `byCollector.${field}`);
  }
  for (const method of facts.paymentMethods) {
    count(method.validPaymentsCount, 'paymentMethods.validPaymentsCount');
    money(method.totalCollectedAmount, 'paymentMethods.totalCollectedAmount');
  }
  for (const item of facts.evolution) {
    count(item.validPaymentsCount, 'evolution.validPaymentsCount');
    count(item.annulledPaymentsCount, 'evolution.annulledPaymentsCount');
    money(item.totalCollectedAmount, 'evolution.totalCollectedAmount');
    money(item.annulledAmount, 'evolution.annulledAmount');
  }
  for (const [field, value] of Object.entries(facts.unattributedPayments)) {
    if (typeof value === 'number') count(value, `unattributedPayments.${field}`);
    else money(value, `unattributedPayments.${field}`);
  }

  const summary = facts.summary;
  if (facts.byCollector.length !== summary.totalCollectors ||
    summary.activeCollectors + summary.inactiveCollectors !== summary.totalCollectors ||
    summary.linkedCollectors + summary.unlinkedCollectors !== summary.totalCollectors ||
    summary.collectorsWithValidPayments + summary.collectorsWithoutValidPayments !== summary.totalCollectors)
    throw new CollectorStatisticsIntegrityError('La clasificación de cobradores no coincide con el total.');

  if (cents(summary.principalAppliedAmount) + cents(summary.interestAppliedAmount) !==
    cents(summary.totalCollectedAmount) || facts.byCollector.some((collector) =>
    cents(collector.principalAppliedAmount) + cents(collector.interestAppliedAmount) !==
      cents(collector.totalCollectedAmount)))
    throw new CollectorStatisticsIntegrityError('Capital e interés no coinciden con el monto recaudado.');

  const collectorValidCount = facts.byCollector.reduce((total, item) => total + item.validPaymentsCount, 0);
  const collectorAnnulledCount = facts.byCollector.reduce((total, item) => total + item.annulledPaymentsCount, 0);
  if (collectorValidCount !== summary.validPaymentsCount || collectorAnnulledCount !== summary.annulledPaymentsCount ||
    sumMoney(facts.byCollector.map((item) => item.totalCollectedAmount)) !== cents(summary.totalCollectedAmount) ||
    sumMoney(facts.byCollector.map((item) => item.annulledAmount)) !== cents(summary.annulledAmount))
    throw new CollectorStatisticsIntegrityError('Los totales por cobrador no coinciden con el resumen.');

  const expectedPeriods = period.month === null
    ? Array.from({ length: 12 }, (_, index) => `${period.year}-${String(index + 1).padStart(2, '0')}`)
    : Array.from({ length: new Date(Date.UTC(period.year, period.month, 0)).getUTCDate() },
      (_, index) => `${period.year}-${String(period.month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`);
  if (facts.evolution.length !== expectedPeriods.length ||
    facts.evolution.some((item, index) => item.period !== expectedPeriods[index]))
    throw new CollectorStatisticsIntegrityError('La evolución no contiene todo el período en orden.');

  const reconcileBreakdown = (items: Array<{ validPaymentsCount: number; totalCollectedAmount: string }>, label: string) => {
    if (items.reduce((total, item) => total + item.validPaymentsCount, 0) !== summary.validPaymentsCount ||
      sumMoney(items.map((item) => item.totalCollectedAmount)) !== cents(summary.totalCollectedAmount))
      throw new CollectorStatisticsIntegrityError(`${label} no coincide con el resumen.`);
  };
  reconcileBreakdown(facts.paymentMethods, 'El desglose por método');
  reconcileBreakdown(facts.evolution, 'La evolución');
  if (facts.evolution.reduce((total, item) => total + item.annulledPaymentsCount, 0) !==
      summary.annulledPaymentsCount ||
    sumMoney(facts.evolution.map((item) => item.annulledAmount)) !== cents(summary.annulledAmount))
    throw new CollectorStatisticsIntegrityError('Las anulaciones de la evolución no coinciden con el resumen.');

  const assignedCustomers = facts.byCollector
    .filter((collector) => collector.isActive)
    .reduce((total, collector) => total + collector.currentAssignedActiveCustomers, 0);
  const averageAssignedCustomersPerActiveCollector = summary.activeCollectors === 0
    ? 0
    : Number((assignedCustomers / summary.activeCollectors).toFixed(2));

  return {
    period: {
      year: period.year,
      month: period.month,
      startDate: period.startDate,
      endDate: period.endDate,
      timeZone: 'America/Costa_Rica',
    },
    semantics: {
      paymentDateBasis: 'PAYMENT_DATE' as const,
      paymentValidityBasis: 'CURRENT_STATUS' as const,
      assignmentSnapshot: 'CURRENT' as const,
    },
    summary: { ...summary, averageAssignedCustomersPerActiveCollector },
    byCollector: facts.byCollector,
    paymentMethods: facts.paymentMethods,
    evolution: facts.evolution,
    unattributedPayments: facts.unattributedPayments,
  };
}
