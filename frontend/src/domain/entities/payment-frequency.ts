export type IntervalUnit = 'DAY' | 'WEEK' | 'DAY/15' | 'MONTH';
export type PaymentFrequency = { id: string; name: string; intervalUnit: IntervalUnit; intervalValue: number; order: number; isActive: boolean; createdAt?: string; updatedAt?: string };
