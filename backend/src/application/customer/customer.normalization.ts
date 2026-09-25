import { CustomerValidationError } from '../../domain/customer/customer.errors';

export const normalizeBusinessText = (value: string): string => value.trim().toUpperCase();
export const normalizeOptionalBusinessText = (value?: string): string | undefined => {
  const normalized = value === undefined ? undefined : normalizeBusinessText(value);
  return normalized || undefined;
};

export const normalizeEmail = (value?: string): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
};

export const normalizeNationalIdentification = (value: string): string => {
  const digits = value.trim().replace(/\D/g, '');
  if (!/^\d{9}$/.test(digits)) throw new CustomerValidationError('La identificación nacional debe tener 9 dígitos.');
  return digits;
};

export const normalizeForeignIdentification = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 40 || !/^[\p{L}0-9 -]+$/u.test(normalized)) throw new CustomerValidationError('La identificación extranjera no es válida.');
  return normalized;
};
