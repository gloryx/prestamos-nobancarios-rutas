import type { CustomerForm } from '../../domain/entities/customer';

export type Nationality = Exclude<CustomerForm['nationality'], ''>;

export const nationalityLabels: Record<Nationality, string> = {
  COSTA_RICAN: 'Costa Rica',
  NICARAGUAN: 'Nicaragua',
  PANAMANIAN: 'Panamá',
  HONDURAN: 'Honduras',
  OTHER: 'Otro',
};

export function formatNationality(nationality: CustomerForm['nationality'], otherNationality?: string): string {
  if (nationality === 'OTHER') return otherNationality || nationalityLabels.OTHER;
  return nationality ? nationalityLabels[nationality] : '—';
}
