import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerFinancialAnalysisController } from '../../application/use-cases/customer-financial-analysis-controller';
import { CustomerSelectionModal } from '../components/CustomerSelectionModal';
import { FinancialAnalysisLanding, FinancialAnalysisPage, FinancialAnalysisReport } from './FinancialAnalysisPage';

type EffectSlot = { pending?: () => void | (() => void) };
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as EffectSlot[],
  stateIndex: 0, refIndex: 0, effectIndex: 0 }));
const route = vi.hoisted(() => ({
  customerId: undefined as string | undefined,
  params: new URLSearchParams(),
  navigate: vi.fn(),
  setParams: vi.fn((next: URLSearchParams) => { route.params = new URLSearchParams(next); }),
  canListCustomers: true,
}));

vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (value: unknown) => {
      hooks.states[index] = typeof value === 'function'
        ? (value as (previous: unknown) => unknown)(hooks.states[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial });
  },
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => void | (() => void)) => { hooks.effects[hooks.effectIndex++] = { pending: effect }; },
}));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(),
  useParams: () => ({ customerId: route.customerId }),
  useNavigate: () => route.navigate,
  useSearchParams: () => [route.params, route.setParams],
}));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({
  can: (permission: string) => permission !== 'customers.view' || route.canListCustomers,
}) }));

function components(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(components);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...components(element.props.children)];
}

function renderPage(): ReactElement {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effectIndex = 0;
  return FinancialAnalysisPage();
}

describe('financial analysis customer selection flow', () => {
  beforeEach(() => {
    hooks.states = [];
    hooks.refs = [];
    hooks.effects = [];
    route.customerId = undefined;
    route.params = new URLSearchParams();
    route.navigate.mockClear();
    route.setParams.mockClear();
    route.canListCustomers = true;
  });

  it('opens the selector on the module base route and cancellation leaves the empty module in place', () => {
    let page = renderPage();
    expect(components(page).some((element) => element.type === FinancialAnalysisLanding)).toBe(true);
    const modal = components(page).find((element) => element.type === CustomerSelectionModal);
    expect(modal).toBeDefined();
    (modal?.props as { onClose: () => void }).onClose();
    page = renderPage();
    expect(components(page).some((element) => element.type === CustomerSelectionModal)).toBe(false);
    expect(components(page).some((element) => element.type === FinancialAnalysisLanding)).toBe(true);
    expect(route.navigate).not.toHaveBeenCalled();
  });

  it('opens the same modal from a selected customer and cancel preserves customer and cutoff', () => {
    route.customerId = 'customer-a';
    route.params = new URLSearchParams({ asOf: '2026-10-03' });
    let page = renderPage();
    const report = components(page).find((element) => element.type === FinancialAnalysisReport);
    expect(report?.props).toMatchObject({ customerId: 'customer-a', initialAsOf: '2026-10-03' });
    (report?.props as { onChangeCustomer: () => void }).onChangeCustomer();
    page = renderPage();
    const modal = components(page).find((element) => element.type === CustomerSelectionModal);
    expect(modal).toBeDefined();
    (modal?.props as { onClose: () => void }).onClose();
    page = renderPage();
    expect(components(page).some((element) => element.type === CustomerSelectionModal)).toBe(false);
    expect(components(page).find((element) => element.type === FinancialAnalysisReport)?.props)
      .toMatchObject({ customerId: 'customer-a', initialAsOf: '2026-10-03' });
    expect(route.navigate).not.toHaveBeenCalled();
  });

  it('navigates to the selected historical customer and preserves the current asOf query', () => {
    route.customerId = 'customer-a';
    route.params = new URLSearchParams({ asOf: '2026-09-30' });
    let page = renderPage();
    const report = components(page).find((element) => element.type === FinancialAnalysisReport);
    (report?.props as { onChangeCustomer: () => void }).onChangeCustomer();
    page = renderPage();
    const modal = components(page).find((element) => element.type === CustomerSelectionModal);
    (modal?.props as { onSelect: (customer: object) => void }).onSelect({
      id: 'historical/customer', identification: '123', fullName: 'Histórico', primaryPhone: '', address: '', isActive: false,
    });
    expect(route.navigate).toHaveBeenCalledExactlyOnceWith(
      '/customers/historical%2Fcustomer/financial-analysis?asOf=2026-09-30',
    );
  });

  it('keeps the cutoff in the URL so the next customer uses the updated date', () => {
    route.customerId = 'customer-a';
    route.params = new URLSearchParams({ asOf: '2026-10-03' });
    let page = renderPage();
    const report = components(page).find((element) => element.type === FinancialAnalysisReport);
    (report?.props as { onAsOfChange: (value: string) => void }).onAsOfChange('2026-09-15');
    expect(route.setParams).toHaveBeenCalledWith(expect.any(URLSearchParams), { replace: true });
    page = renderPage();
    const updatedReport = components(page).find((element) => element.type === FinancialAnalysisReport);
    expect(updatedReport?.props).toMatchObject({ initialAsOf: '2026-09-15' });
  });

  it('loads the selected customer analysis through the authoritative controller', async () => {
    const api = { load: vi.fn(async () => { throw new Error('stop after proving request'); }) };
    const controller = new CustomerFinancialAnalysisController(api, 'customer-b', '2026-09-30', () => '2026-10-03');
    hooks.states = [];
    hooks.effects = [];
    hooks.stateIndex = 0;
    hooks.refIndex = 0;
    hooks.effectIndex = 0;
    FinancialAnalysisReport({ supplied: controller, customerId: 'customer-b', initialAsOf: '2026-09-30',
      canChangeCustomer: true, onChangeCustomer: () => undefined, onAsOfChange: () => undefined });
    await hooks.effects[0].pending?.();
    expect(api.load).toHaveBeenCalledExactlyOnceWith('customer-b', '2026-09-30');
  });
});
