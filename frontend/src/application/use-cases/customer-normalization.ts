import type { CustomerForm } from '../../domain/entities/customer';

const businessTextFields = new Set<keyof CustomerForm>(['firstName', 'middleName', 'firstLastName', 'secondLastName', 'otherNationality', 'exactAddress', 'observations']);
const normalizeInteractiveText = (value: string): string => value.toUpperCase();
const normalizeFinalText = (value: string): string => value.trim().toUpperCase();

export const normalizeCustomerField = <K extends keyof CustomerForm>(field: K, value: CustomerForm[K], identificationType: CustomerForm['identificationType']): CustomerForm[K] => {
  if (field === 'identification') {
    if (identificationType === 'NATIONAL') {
      const digits = String(value).replace(/\D/g, '').slice(0, 9);
      return digits.replace(/(\d)(\d{4})(\d{4})/, '$1-$2-$3') as CustomerForm[K];
    }
    return normalizeInteractiveText(String(value)) as CustomerForm[K];
  }
  if (field === 'email') return String(value).toLowerCase() as CustomerForm[K];
  if (businessTextFields.has(field)) return normalizeInteractiveText(String(value)) as CustomerForm[K];
  return value;
};

export const normalizeCustomerPatch = (patch: Partial<CustomerForm>, identificationType: CustomerForm['identificationType']): Partial<CustomerForm> => Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, normalizeCustomerField(field as keyof CustomerForm, value as never, identificationType)])) as Partial<CustomerForm>;

export const normalizeCustomerForm = (input: Partial<CustomerForm>): Partial<CustomerForm> => {
  const normalized = { ...input };
  for (const field of businessTextFields) {
    if (input[field] !== undefined) normalized[field] = normalizeFinalText(String(input[field])) as never;
  }
  if (input.email !== undefined) normalized.email = String(input.email).trim().toLowerCase();
  if (input.identification !== undefined) normalized.identification = input.identificationType === 'NATIONAL' ? String(input.identification).replace(/\D/g, '') : String(input.identification).trim().toUpperCase();
  return normalized;
};
