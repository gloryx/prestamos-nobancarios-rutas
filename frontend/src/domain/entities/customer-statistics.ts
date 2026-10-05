export type CustomerStatistics = {
  year: number;
  summary: {
    totalCustomers: number;
    customersWithActiveDebt: number;
    customersWithoutCurrentDebt: number;
    customersWithUncollectibleDebt: number;
    customersWithRefinancingHistory: number;
    customersWithCancelledLoans: number;
    customersWithAnnulledLoans: number;
    customersWithMultipleLoans: number;
    averageLoansPerCustomer: number;
    newCustomersInYear: number;
    newCustomersCurrentMonth: number | null;
  };
  currentSituation: {
    activeDebt: number;
    uncollectibleOnly: number;
    noCurrentDebt: number;
  };
  monthlyNewCustomers: Array<{ month: number; newCustomers: number }>;
  topCustomers: {
    capitalDisbursed: Array<{ customerId: string; fullName: string; value: string }>;
    loansPlaced: Array<{ customerId: string; fullName: string; value: number }>;
    realizedGain: Array<{ customerId: string; fullName: string; value: string }>;
    recoveredPrincipal: Array<{ customerId: string; fullName: string; value: string }>;
    currentBalance: Array<{ customerId: string; fullName: string; value: string }>;
  };
};
