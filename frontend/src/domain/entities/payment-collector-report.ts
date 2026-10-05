export type PaymentCollectorReportFilters = {
  fromDate: string;
  toDate: string;
  collectorId: string;
  paymentMethodId: string;
};

export type PaymentCollectorReportRow = {
  collectorId: string;
  collectorName: string;
  collectorActive: boolean;
  paymentsCount: number;
  customersCount: number;
  loansCount: number;
  totalReceived: string;
  principalApplied: string;
  interestApplied: string;
  averagePayment: string;
  participationPercentage: string;
};

export type PaymentCollectorReportResult = {
  filters: Omit<PaymentCollectorReportFilters, 'collectorId' | 'paymentMethodId'> & {
    collectorId?: string;
    paymentMethodId?: string;
  };
  summary: {
    paymentsCount: number;
    totalReceived: string;
    principalApplied: string;
    interestApplied: string;
  };
  collectors: PaymentCollectorReportRow[];
  options: {
    collectors: Array<{ id: string; name: string; active: boolean }>;
    paymentMethods: Array<{ id: string; name: string; active: boolean }>;
  };
};
