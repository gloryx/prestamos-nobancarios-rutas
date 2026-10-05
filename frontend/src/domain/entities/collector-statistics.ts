export type CollectorStatistics = {
  period: {
    year: number;
    month: number | null;
    startDate: string;
    endDate: string;
    timeZone: 'America/Costa_Rica';
  };
  semantics: {
    paymentDateBasis: 'PAYMENT_DATE';
    paymentValidityBasis: 'CURRENT_STATUS';
    assignmentSnapshot: 'CURRENT';
  };
  summary: {
    totalCollectors: number;
    activeCollectors: number;
    inactiveCollectors: number;
    collectorsWithValidPayments: number;
    collectorsWithoutValidPayments: number;
    activeCollectorsWithoutValidPayments: number;
    linkedCollectors: number;
    unlinkedCollectors: number;
    validPaymentsCount: number;
    uniqueCustomersServed: number;
    totalCollectedAmount: string;
    principalAppliedAmount: string;
    interestAppliedAmount: string;
    averageValidPaymentAmount: string;
    annulledPaymentsCount: number;
    annulledAmount: string;
    averageAssignedCustomersPerActiveCollector: number;
  };
  byCollector: Array<{
    collectorId: string;
    identification: string;
    fullName: string;
    isActive: boolean;
    userLinked: boolean;
    validPaymentsCount: number;
    uniqueCustomersServed: number;
    totalCollectedAmount: string;
    principalAppliedAmount: string;
    interestAppliedAmount: string;
    averageValidPaymentAmount: string;
    annulledPaymentsCount: number;
    annulledAmount: string;
    currentActiveRoutes: number;
    currentAssignedActiveCustomers: number;
  }>;
  paymentMethods: Array<{
    paymentMethodId: string;
    name: string;
    currentlyActive: boolean;
    validPaymentsCount: number;
    totalCollectedAmount: string;
  }>;
  evolution: Array<{
    period: string;
    validPaymentsCount: number;
    uniqueCustomersServed: number;
    totalCollectedAmount: string;
    annulledPaymentsCount: number;
    annulledAmount: string;
  }>;
  unattributedPayments: {
    validPaymentsCount: number;
    totalCollectedAmount: string;
    annulledPaymentsCount: number;
    annulledAmount: string;
  };
};
