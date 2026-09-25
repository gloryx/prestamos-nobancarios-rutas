import { describe, expect, it } from 'vitest';
import { normalizeCustomerField, normalizeCustomerForm } from './customer-normalization';

describe('customer text normalization', () => {
  it('preserves spaces while typing compound business text', () => {
    expect(normalizeCustomerField('firstName', 'JUAN ', 'NATIONAL')).toBe('JUAN ');
    expect(normalizeCustomerField('firstName', 'María del Carmen', 'NATIONAL')).toBe('MARÍA DEL CARMEN');
    expect(normalizeCustomerField('firstLastName', 'De la Cruz', 'NATIONAL')).toBe('DE LA CRUZ');
    expect(normalizeCustomerField('exactAddress', '300 metros norte de la iglesia', 'NATIONAL')).toBe('300 METROS NORTE DE LA IGLESIA');
    expect(normalizeCustomerField('observations', 'Casa con portón\nnegro', 'NATIONAL')).toBe('CASA CON PORTÓN\nNEGRO');
    expect(normalizeCustomerField('identification', 'PA 123456', 'FOREIGN')).toBe('PA 123456');
  });

  it('trims only at final form normalization', () => {
    const normalized = normalizeCustomerForm({
      firstName: '  Juan Carlos  ',
      middleName: ' María José ',
      firstLastName: ' De la Cruz ',
      secondLastName: ' Van der Laat ',
      exactAddress: ' 300 metros norte de la iglesia ',
      observations: ' trabaja por cuenta propia\n  visita en la tarde ',
      identificationType: 'NATIONAL',
    });

    expect(normalized.firstName).toBe('JUAN CARLOS');
    expect(normalized.middleName).toBe('MARÍA JOSÉ');
    expect(normalized.firstLastName).toBe('DE LA CRUZ');
    expect(normalized.secondLastName).toBe('VAN DER LAAT');
    expect(normalized.exactAddress).toBe('300 METROS NORTE DE LA IGLESIA');
    expect(normalized.observations).toBe('TRABAJA POR CUENTA PROPIA\n  VISITA EN LA TARDE');
  });
});
