export type CollectorPaymentsReportQuery = {
  fromDate: string;
  toDate: string;
  collectorId?: string;
  paymentMethodId?: string;
};

export type CollectorPaymentsReportRow = {
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

export type CollectorPaymentsReportResult = {
  filters: CollectorPaymentsReportQuery;
  summary: {
    paymentsCount: number;
    totalReceived: string;
    principalApplied: string;
    interestApplied: string;
  };
  collectors: CollectorPaymentsReportRow[];
  options: {
    collectors: Array<{ id: string; name: string; active: boolean }>;
    paymentMethods: Array<{ id: string; name: string; active: boolean }>;
  };
};

export interface CollectorPaymentsReportReader {
  read(query: CollectorPaymentsReportQuery): Promise<CollectorPaymentsReportResult>;
}

export const COLLECTOR_PAYMENTS_REPORT_READER = Symbol('COLLECTOR_PAYMENTS_REPORT_READER');
export class CollectorPaymentsReportValidationError extends Error {}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export class CollectorPaymentsReportUseCase {
  constructor(private readonly reader: CollectorPaymentsReportReader) {}

  execute(query: CollectorPaymentsReportQuery): Promise<CollectorPaymentsReportResult> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!validDate(query.fromDate) || !validDate(query.toDate) || query.fromDate > query.toDate ||
      (query.collectorId !== undefined && !uuid.test(query.collectorId)) ||
      (query.paymentMethodId !== undefined && !uuid.test(query.paymentMethodId))) {
      throw new CollectorPaymentsReportValidationError('Los filtros del reporte de cobros por cobrador no son válidos.');
    }
    return this.reader.read(query);
  }
}
