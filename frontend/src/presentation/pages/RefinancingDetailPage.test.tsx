import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefinancingResult } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { loanRefinancingOperations } from '../../infrastructure/api/loan-refinancing.api';
import { RefinancingDetailPage } from './RefinancingDetailPage';
import { RefinancingResultView } from './RefinancingResultView';

const hooks = vi.hoisted(() => ({ id: 'ref-1', states: [] as unknown[], effects: [] as Array<() => void>, index: 0,
  created: null as RefinancingResult | null, navigate: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ?
      (next as (value: unknown) => unknown)(hooks.states[index]) : next; }]; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useRef: () => ({ current: null }),
}));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(),
  useParams: () => ({ id: hooks.id }),
  useNavigate: () => hooks.navigate,
  useLocation: () => ({ state: hooks.created ? { createdRefinancing: hooks.created } : null }),
}));
vi.mock('../../infrastructure/api/loan-refinancing.api', () => ({ loanRefinancingOperations: { detail: vi.fn() } }));

const result = { refinancingId: 'ref-1', newLoan: { id: 'new-1', status: 'ACTIVE' } } as RefinancingResult;
const render = () => { hooks.index = 0; hooks.effects = []; return RefinancingDetailPage(); };

describe('persisted refinancing detail', () => {
  beforeEach(() => { hooks.id = 'ref-1'; hooks.created = null; hooks.navigate.mockReset(); hooks.states = []; hooks.effects = [];
    vi.mocked(loanRefinancingOperations.detail).mockReset(); });

  it('reads the result from GET and never submits another refinancing', async () => {
    vi.mocked(loanRefinancingOperations.detail).mockResolvedValueOnce(result);
    expect(render().props).toMatchObject({ role: 'status' });
    hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ id: 'ref-1', value: result }));
    const detail = render();
    expect(detail.type).toBe(RefinancingResultView);
    expect(detail.props).toMatchObject({ result });
    expect(loanRefinancingOperations.detail).toHaveBeenCalledExactlyOnceWith('ref-1');
  });

  it('does not show an old refinancing when the URL changes', async () => {
    vi.mocked(loanRefinancingOperations.detail).mockResolvedValueOnce(result);
    render(); hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.states[1]).toMatchObject({ id: 'ref-1' }));
    hooks.id = 'ref-2';
    expect(render().type).not.toBe(RefinancingResultView);
  });

  it('shows the POST receipt immediately on its persistent URL and still reads persisted detail', () => {
    hooks.created = result;
    vi.mocked(loanRefinancingOperations.detail).mockResolvedValueOnce(result);
    const screen = render();
    expect(screen.type).toBe(RefinancingResultView);
    expect(screen.props).toMatchObject({ result, onNew: expect.any(Function) });
    hooks.effects[0]();
    expect(loanRefinancingOperations.detail).toHaveBeenCalledExactlyOnceWith('ref-1');
    (screen.props as { onNew: () => void }).onNew();
    expect(hooks.navigate).toHaveBeenCalledExactlyOnceWith('/loan-refinancings/new');
  });

  it('maps missing details and other failures to safe messages with a retry', async () => {
    vi.mocked(loanRefinancingOperations.detail).mockRejectedValueOnce(new HttpApiError(404, 'SQL details'))
      .mockRejectedValueOnce(new TypeError('network'));
    render(); hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.states[2]).toMatchObject({ id: 'ref-1', cause: expect.any(HttpApiError) }));
    const missing = render();
    expect(missing.props).toMatchObject({ role: 'alert' });
    const text = JSON.stringify(missing);
    expect(text).toContain('no está disponible'); expect(text).not.toContain('SQL details');
    const children = (missing.props as { children: Array<{ props?: { onClick?: () => void } }> }).children;
    children[1].props?.onClick?.();
    render(); hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.states[2]).toMatchObject({ id: 'ref-1', cause: expect.any(TypeError) }));
    expect(JSON.stringify(render())).toContain('No se pudo consultar');
  });
});
