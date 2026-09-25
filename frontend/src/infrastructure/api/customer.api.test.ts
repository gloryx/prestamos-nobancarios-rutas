import { describe, expect, it, vi } from 'vitest';
import { buildCustomerFormData, CustomerApi } from './customer.api';

describe('buildCustomerFormData', () => {
  it('omits identificationFront when absent and includes it when supplied', () => {
    const withoutPhoto = buildCustomerFormData({ identificationType: 'NATIONAL' });
    const photo = new File(['front'], 'front.jpg', { type: 'image/jpeg' });
    const withPhoto = buildCustomerFormData({ identificationType: 'NATIONAL', identificationFront: photo });

    expect(withoutPhoto.has('identificationFront')).toBe(false);
    expect(withPhoto.get('identificationFront')).toBe(photo);
  });
});

describe('CustomerApi site adapters', () => {
  it('loads assigned collectors through the customer site authorization endpoint', async () => {
    const response = { ok: true, status: 200, json: async () => [{ id: 'collector-1', fullName: 'Ana Pérez', username: 'aperez' }] } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await new CustomerApi().assignedCollectors('customer-1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/customers/customer-1/site-assigned-collectors', expect.objectContaining({ credentials: 'include' }));
    fetchMock.mockRestore();
  });

  it('uses the scoped assigned endpoint instead of listing and filtering customers', async () => {
    const response = { ok: true, status: 200, json: async () => [] } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    await new CustomerApi().assigned();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/customers/assigned', expect.objectContaining({ credentials: 'include' }));
    expect(fetchMock.mock.calls[0][0]).not.toContain('/customers?');
    fetchMock.mockRestore();
  });

  it('maps only supplied site fields to multipart form data', async () => {
    const response = { ok: true, status: 200, json: async () => ({}) } as Response;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const photo = new File(['photo'], 'site.jpg', { type: 'image/jpeg' });
    await new CustomerApi().updateSite('customer-1', { propertyPhoto: photo });
    const request = fetchMock.mock.calls[0][1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).has('latitude')).toBe(false);
    expect((request?.body as FormData).get('propertyPhoto')).toBe(photo);
    fetchMock.mockRestore();
  });
});
