export type MonthlyNewCustomers = { month: number; newCustomers: number };
export type CustomerMonetaryRankingItem = { customerId: string; fullName: string; value: string };
export type CustomerCountRankingItem = { customerId: string; fullName: string; value: number };
export type CustomerTopRankings = {
  capitalDisbursed: CustomerMonetaryRankingItem[];
  loansPlaced: CustomerCountRankingItem[];
  realizedGain: CustomerMonetaryRankingItem[];
  recoveredPrincipal: CustomerMonetaryRankingItem[];
  currentBalance: CustomerMonetaryRankingItem[];
};

export type CustomerStatisticsFacts = {
  totalCustomers: number;
  customersWithActiveDebt: number;
  customersWithUncollectibleDebt: number;
  customersWithRefinancingHistory: number;
  customersWithCancelledLoans: number;
  customersWithAnnulledLoans: number;
  customersWithMultipleLoans: number;
  validLoanCount: number;
  newCustomersInYear: number;
  newCustomersCurrentMonth: number;
  currentSituation: { activeDebt: number; uncollectibleOnly: number; noCurrentDebt: number };
  monthlyNewCustomers: MonthlyNewCustomers[];
  topCustomers: CustomerTopRankings;
};

export class CustomerStatisticsIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerStatisticsIntegrityError';
  }
}

const countFields = [
  'totalCustomers', 'customersWithActiveDebt', 'customersWithUncollectibleDebt',
  'customersWithRefinancingHistory', 'customersWithCancelledLoans', 'customersWithAnnulledLoans',
  'customersWithMultipleLoans', 'validLoanCount', 'newCustomersInYear', 'newCustomersCurrentMonth',
] as const;

const moneyCents = (value: string): bigint | null => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};

const validateRanking = (name: string, items: Array<CustomerMonetaryRankingItem | CustomerCountRankingItem>, monetary: boolean, limit: number): void => {
  if (items.length > limit) throw new CustomerStatisticsIntegrityError(`El ranking ${name} supera el TOP ${limit}.`);
  const ids = new Set<string>();
  let previous: bigint | null = null;
  for (const item of items) {
    if (!item.customerId || !item.fullName.trim() || ids.has(item.customerId)) throw new CustomerStatisticsIntegrityError(`El ranking ${name} contiene un cliente inválido o duplicado.`);
    ids.add(item.customerId);
    const value = monetary ? typeof item.value === 'string' ? moneyCents(item.value) : null
      : typeof item.value === 'number' && Number.isSafeInteger(item.value) && item.value >= 0 ? BigInt(item.value) : null;
    if (value === null || value <= 0n || (previous !== null && value > previous)) throw new CustomerStatisticsIntegrityError(`El ranking ${name} contiene valores inválidos o desordenados.`);
    previous = value;
  }
};

export function calculateCustomerStatistics(year: number, currentYear: number, rankingLimit: number, facts: CustomerStatisticsFacts) {
  for (const field of countFields) {
    if (!Number.isSafeInteger(facts[field]) || facts[field] < 0)
      throw new CustomerStatisticsIntegrityError(`El conteo ${field} no es válido.`);
  }
  for (const [field, value] of Object.entries(facts.currentSituation)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new CustomerStatisticsIntegrityError(`El conteo currentSituation.${field} no es válido.`);
  }
  if (facts.monthlyNewCustomers.length !== 12 || facts.monthlyNewCustomers.some((item, index) =>
    item.month !== index + 1 || !Number.isSafeInteger(item.newCustomers) || item.newCustomers < 0))
    throw new CustomerStatisticsIntegrityError('La evolución mensual debe contener los 12 meses en orden y con conteos válidos.');
  const monthlyTotal = facts.monthlyNewCustomers.reduce((sum, item) => sum + item.newCustomers, 0);
  if (monthlyTotal !== facts.newCustomersInYear)
    throw new CustomerStatisticsIntegrityError('La suma mensual no coincide con los clientes nuevos del año.');
  const situationTotal = facts.currentSituation.activeDebt + facts.currentSituation.uncollectibleOnly +
    facts.currentSituation.noCurrentDebt;
  if (situationTotal !== facts.totalCustomers)
    throw new CustomerStatisticsIntegrityError('La situación actual no clasifica exactamente a todos los clientes.');
  if (facts.currentSituation.activeDebt !== facts.customersWithActiveDebt)
    throw new CustomerStatisticsIntegrityError('La deuda activa no coincide con la clasificación actual.');
  if (facts.currentSituation.uncollectibleOnly > facts.customersWithUncollectibleDebt)
    throw new CustomerStatisticsIntegrityError('La clasificación incobrable supera a los clientes con incobrables.');
  for (const field of countFields.slice(1, 7)) {
    if (facts[field] > facts.totalCustomers)
      throw new CustomerStatisticsIntegrityError(`El conteo ${field} supera el total de clientes.`);
  }
  if (facts.newCustomersInYear > facts.totalCustomers || facts.newCustomersCurrentMonth > facts.totalCustomers ||
    facts.monthlyNewCustomers.some((item) => item.newCustomers > facts.totalCustomers))
    throw new CustomerStatisticsIntegrityError('Los clientes nuevos superan el total de clientes.');
  validateRanking('capitalDisbursed', facts.topCustomers.capitalDisbursed, true, rankingLimit);
  validateRanking('loansPlaced', facts.topCustomers.loansPlaced, false, rankingLimit);
  validateRanking('realizedGain', facts.topCustomers.realizedGain, true, rankingLimit);
  validateRanking('recoveredPrincipal', facts.topCustomers.recoveredPrincipal, true, rankingLimit);
  validateRanking('currentBalance', facts.topCustomers.currentBalance, true, rankingLimit);
  const averageLoansPerCustomer = facts.totalCustomers === 0
    ? 0
    : Number((facts.validLoanCount / facts.totalCustomers).toFixed(2));
  return {
    year,
    summary: {
      totalCustomers: facts.totalCustomers,
      customersWithActiveDebt: facts.customersWithActiveDebt,
      customersWithoutCurrentDebt: facts.currentSituation.noCurrentDebt,
      customersWithUncollectibleDebt: facts.customersWithUncollectibleDebt,
      customersWithRefinancingHistory: facts.customersWithRefinancingHistory,
      customersWithCancelledLoans: facts.customersWithCancelledLoans,
      customersWithAnnulledLoans: facts.customersWithAnnulledLoans,
      customersWithMultipleLoans: facts.customersWithMultipleLoans,
      averageLoansPerCustomer,
      newCustomersInYear: facts.newCustomersInYear,
      newCustomersCurrentMonth: year === currentYear ? facts.newCustomersCurrentMonth : null,
    },
    currentSituation: facts.currentSituation,
    monthlyNewCustomers: facts.monthlyNewCustomers,
    topCustomers: facts.topCustomers,
  };
}
