import { describe, expect, it, vi } from 'vitest';
import type { FinancialClosePreview } from '../../domain/entities/financial-close';
import { FinancialCloseController, type FinancialClosePort } from './financial-close-controller';

const section = { values: {} };
const preview = (errors: FinancialClosePreview['errors'] = []): FinancialClosePreview => ({ period: '2026-10', errors,
  warnings: [], sections: { liquidity: section, contractualPortfolio: section, economicCapital: section,
    refinancings: section, profitability: section, reconciliations: section } });
const detail = { ...preview(), id: 'close-1', confirmedAt: '2026-11-01T00:00:00Z', confirmedBy: 'Ana' };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(errors: FinancialClosePreview['errors'] = []) {
  const api: FinancialClosePort = { preview: vi.fn(async () => preview(errors)), confirm: vi.fn(async () => detail),
    list: vi.fn(async () => []), detail: vi.fn(async () => detail) };
  return { api, controller: new FinancialCloseController(api, '2026-10') };
}

describe('FinancialCloseController', () => {
  it('loads server preview and history and clears stale preview when the period changes', async () => {
    const { api, controller } = setup(); await controller.load();
    expect(api.preview).toHaveBeenCalledWith('2026-10'); expect(api.list).toHaveBeenCalled();
    controller.setPeriod('2026-09');
    expect(controller.getSnapshot()).toMatchObject({ period: '2026-09', preview: null, loading: true });
    await tick(); expect(api.preview).toHaveBeenLastCalledWith('2026-09');
  });

  it('requires an explicit confirmation step and sends only the selected period through the port', async () => {
    const { api, controller } = setup(); await controller.load();
    await controller.confirm(); expect(api.confirm).not.toHaveBeenCalled();
    controller.requestConfirmation(); expect(controller.getSnapshot().confirmationOpen).toBe(true);
    await controller.confirm();
    expect(api.confirm).toHaveBeenCalledWith('2026-10');
    expect(controller.getSnapshot()).toMatchObject({ confirmationOpen: false, confirming: false, detail, preview: null });
  });

  it('never opens or performs confirmation when preview has errors', async () => {
    const { api, controller } = setup([{ message: 'Conciliación pendiente', section: 'reconciliations' }]);
    await controller.load(); controller.requestConfirmation(); await controller.confirm();
    expect(controller.getSnapshot().confirmationOpen).toBe(false); expect(api.confirm).not.toHaveBeenCalled();
  });

  it('loads immutable history detail by id', async () => {
    const { api, controller } = setup(); await controller.openDetail('close-1');
    expect(api.detail).toHaveBeenCalledWith('close-1'); expect(controller.getSnapshot().detail).toEqual(detail);
  });
});
