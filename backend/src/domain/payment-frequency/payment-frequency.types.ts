export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH';

export type PaymentFrequency = {
  id: string;
  name: string;
  intervalUnit: IntervalUnit;
  intervalValue: number;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
