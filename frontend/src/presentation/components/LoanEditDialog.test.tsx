import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoanEditContext } from '../../domain/entities/loan';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { editContext } from '../helpers/loan-edit.fixture';
import { MoneyInput } from './MoneyInput';
import { PaymentPlanDraftFields } from './PaymentPlanDraftFields';
import { LoanEditDialog } from './LoanEditDialog';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => void>, stateIndex: 0, refIndex: 0,
  toast: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.stateIndex++; if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = typeof value === 'function' ? (value as (before: unknown) => unknown)(hooks.states[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ?? (hooks.refs[index] = { current: initial }); },
  useCallback: (fn: unknown) => fn, useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
vi.mock('./ToastContext', () => ({ useToast: () => ({ toast: { success: hooks.toast } }) }));

const nodes = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(nodes)
  : isValidElement(node) ? [node, ...nodes((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : String(node ?? '');
const button = (tree: ReactElement, label: string) => nodes(tree).find((item) => item.type === 'button' && text((item.props as { children?: ReactNode }).children) === label)!;
const press = (item: ReactElement) => (item.props as { onClick: () => void }).onClick();
const submit = (tree: ReactElement) => (nodes(tree).find((item) => item.type === 'form')!.props as { onSubmit: (event: { preventDefault: () => void }) => void }).onSubmit({ preventDefault: vi.fn() });
const api = { editContext: vi.fn<(_id: string) => Promise<LoanEditContext>>(), edit: vi.fn() };
const onSaved = vi.fn(async () => {}), onUnavailable = vi.fn(async () => {}), onClose = vi.fn();
const props = { loanId: 'loan-1', api, onSaved, onUnavailable, onClose };
const render = () => { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = []; return LoanEditDialog(props); };
const open = async () => { const loading = render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.states[0]).toEqual(editContext)); return loading; };
const observations = (tree: ReactElement, value: string) => (nodes(tree).find((item) => item.type === 'textarea')!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });

describe('Loan Edit dialog flow', () => {
  beforeEach(() => {
    hooks.states = []; hooks.refs = []; hooks.toast.mockReset();
    api.editContext.mockReset().mockResolvedValue(editContext); api.edit.mockReset().mockResolvedValue({ operationId: 'op', loanId: 'loan-1', createdAt: '2026-09-30T00:00:00Z' });
    onSaved.mockReset().mockResolvedValue(undefined); onUnavailable.mockReset().mockResolvedValue(undefined); onClose.mockReset();
  });

  it('starts loading, reads fresh scoped options, retains current inactive choices and shows read-only facts', async () => {
    const loading = render(); expect(text(loading)).toContain('Cargando datos del préstamo');
    expect(nodes(loading).some((item) => item.type === 'form')).toBe(false);
    hooks.effects[0](); await vi.waitFor(() => expect(hooks.states[0]).toEqual(editContext));
    const tree = render();
    expect(api.editContext).toHaveBeenCalledExactlyOnceWith('loan-1');
    expect(text(tree)).toContain('Capital (solo lectura)'); expect(text(tree)).toContain('Inicio (solo lectura)');
    expect(text(tree)).toContain('Total actual (solo lectura)'); expect(text(tree)).toContain('Saldo financiero actual (solo lectura)');
    expect(text(tree)).toContain('₡120,00'); expect(text(tree)).toContain('₡60,00');
    const selects = nodes(tree).filter((item) => item.type === 'select');
    expect(selects.map((item) => (item.props as { value: string }).value)).toEqual(['frequency-old', 'method-old']);
    expect(text(selects)).toContain('Antigua (inactivo)'); expect(text(selects)).toContain('Anterior (inactivo)');
    expect(text(selects)).not.toContain('Otra');
    expect((button(tree, 'Guardar cambios').props as { disabled: boolean }).disabled).toBe(true);
    expect(nodes(tree).some((item) => item.type === 'input' && (item.props as { name?: string }).name === 'principal')).toBe(false);
  });

  it('submits metadata only, including active frequency/method and nullable observations, then refetches before toast and close', async () => {
    await open(); let tree = render();
    const selects = nodes(tree).filter((item) => item.type === 'select');
    (selects[0].props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'frequency-new' } });
    tree = render(); (nodes(tree).filter((item) => item.type === 'select')[1].props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'method-new' } });
    tree = render(); observations(tree, '   '); submit(render());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.edit).toHaveBeenCalledOnce();
    const body = api.edit.mock.calls[0][1];
    expect(body).toEqual({ idempotencyKey: expect.any(String), baseline: editContext.baseline,
      changes: { paymentFrequencyId: 'frequency-new', preferredPaymentMethodId: 'method-new', observations: null } });
    expect(body).not.toHaveProperty('plan'); expect(body).not.toHaveProperty('actorId'); expect(body).not.toHaveProperty('principal');
    expect(api.editContext).toHaveBeenCalledTimes(2); expect(onSaved).toHaveBeenCalledOnce();
    expect(api.edit.mock.invocationCallOrder[0]).toBeLessThan(onSaved.mock.invocationCallOrder[0]);
    expect(hooks.toast).toHaveBeenCalledWith('Préstamo actualizado correctamente.');
  });

  it('requires exact-cent plan adjustment, preserves IDs, allows new null IDs and Previous retains the draft', async () => {
    await open(); let tree = render();
    (nodes(tree).find((item) => item.type === MoneyInput)!.props as { onChange: (value: string) => void }).onChange('20.01');
    tree = render(); expect(text(tree)).toContain('₡120,01'); expect(text(tree)).toContain('₡60,01');
    submit(tree); tree = render();
    const plan = nodes(tree).find((item) => item.type === PaymentPlanDraftFields)!;
    expect((plan.props as { balance: string }).balance).toBe('60.01');
    expect((plan.props as { draft: Array<{ id: string | null }> }).draft[0].id).toBe('plan-a');
    expect((button(tree, 'Guardar cambios').props as { disabled: boolean }).disabled).toBe(true);
    const add = (plan.props as { onAdd: () => void }).onAdd; add();
    tree = render(); const withNew = nodes(tree).find((item) => item.type === PaymentPlanDraftFields)!;
    const entries = (withNew.props as { draft: Array<{ key: string; id: string | null; dueDate: string; pendingAmount: string }> }).draft;
    expect(entries[1].id).toBeNull();
    (withNew.props as { onChange: (value: typeof entries) => void }).onChange([{ ...entries[0] }, { ...entries[1], dueDate: '2026-03-02', pendingAmount: '0.01' }]);
    press(button(render(), 'Anterior')); expect(text(render())).toContain('₡60,01');
    submit(render()); submit(render());
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledOnce());
    expect(api.edit.mock.calls[0][1].plan).toEqual([{ id: 'plan-a', dueDate: '2026-02-02', pendingAmount: '60.00' }, { id: null, dueDate: '2026-03-02', pendingAmount: '0.01' }]);
    expect(editContext.baseline.plan).toEqual([{ id: 'plan-a', dueDate: '2026-02-02', pendingAmount: '60.00' }]);
  });

  it('allows an empty plan only when the interest edit reduces the proposed balance to zero', async () => {
    const smallBalance = { ...editContext, baseline: { ...editContext.baseline, financialBalance: '10.00', plan: [{ ...editContext.baseline.plan[0], pendingAmount: '10.00' }] } };
    api.editContext.mockResolvedValue(smallBalance);
    render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.states[0]).toEqual(smallBalance));
    (nodes(render()).find((item) => item.type === MoneyInput)!.props as { onChange: (value: string) => void }).onChange('10.00');
    submit(render());
    const plan = nodes(render()).find((item) => item.type === PaymentPlanDraftFields)!;
    (plan.props as { onChange: (draft: []) => void }).onChange([]);
    const tree = render();
    expect((nodes(tree).find((item) => item.type === PaymentPlanDraftFields)!.props as { balance: string }).balance).toBe('0.00');
    expect((button(tree, 'Guardar cambios').props as { disabled: boolean }).disabled).toBe(false);
    submit(tree); await vi.waitFor(() => expect(api.edit).toHaveBeenCalledOnce());
    expect(api.edit.mock.calls[0][1]).toMatchObject({ baseline: smallBalance.baseline, changes: { interestAmount: '10.00' }, plan: [] });
  });

  it('retains 400 drafts; 409 disables submit until Update GET; 404 closes and refreshes', async () => {
    await open(); observations(render(), 'Change');
    api.edit.mockRejectedValueOnce(new HttpApiError(400, 'Review the amount.'));
    submit(render()); await vi.waitFor(() => expect(hooks.states[9]).toContain('Review the amount.'));
    expect((hooks.states[1] as { observations: string }).observations).toBe('Change');
    api.edit.mockRejectedValueOnce(new HttpApiError(409, 'The loan changed.'));
    submit(render()); await vi.waitFor(() => expect(hooks.states[7]).toBe(true));
    expect(text(render())).toContain('Actualizar datos'); expect((button(render(), 'Guardar cambios').props as { disabled: boolean }).disabled).toBe(true);
    press(button(render(), 'Actualizar datos'));
    await vi.waitFor(() => expect(hooks.states[7]).toBe(false));
    expect((hooks.states[1] as { observations: string }).observations).toBe('ORIGINAL');
    observations(render(), 'Other'); api.edit.mockRejectedValueOnce(new HttpApiError(404, 'Missing'));
    submit(render()); await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce()); expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('blocks a non-active or conflicting context, and closes a missing context without PATCH', async () => {
    api.editContext.mockResolvedValueOnce({ ...editContext, loan: { ...editContext.loan, status: 'CANCELLED' } });
    render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.states[6]).toBe(true));
    expect(nodes(render()).some((item) => item.type === 'form')).toBe(false); expect(onUnavailable).toHaveBeenCalledOnce();
    hooks.states = []; hooks.refs = []; api.editContext.mockRejectedValueOnce(new HttpApiError(409, 'Cannot edit.'));
    render(); hooks.effects[0](); await vi.waitFor(() => expect(hooks.states[6]).toBe(true));
    expect(text(render())).toContain('Cannot edit.');
    hooks.states = []; hooks.refs = []; api.editContext.mockRejectedValueOnce(new HttpApiError(404, 'Missing'));
    render(); hooks.effects[0](); await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.edit).not.toHaveBeenCalled();
  });

  it('retries a failed initial read without sending PATCH or inventing a baseline', async () => {
    api.editContext.mockRejectedValueOnce(new TypeError('Network unavailable'));
    render(); hooks.effects[0]();
    await vi.waitFor(() => expect(hooks.states[9]).toContain('Network unavailable'));
    expect(nodes(render()).some((item) => item.type === 'form')).toBe(false);
    press(button(render(), 'Reintentar carga'));
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(editContext));
    expect(api.editContext).toHaveBeenCalledTimes(2); expect(api.edit).not.toHaveBeenCalled();
  });

  it('blocks an Update GET that becomes unavailable after a PATCH conflict without auto-merging drafts', async () => {
    await open(); observations(render(), 'Other');
    api.edit.mockRejectedValueOnce(new HttpApiError(409, 'Stale baseline.'));
    submit(render()); await vi.waitFor(() => expect(hooks.states[7]).toBe(true));
    api.editContext.mockRejectedValueOnce(new HttpApiError(409, 'Only active loans can be edited.'));
    press(button(render(), 'Actualizar datos'));
    await vi.waitFor(() => expect(hooks.states[6]).toBe(true));
    expect(onUnavailable).toHaveBeenCalledOnce(); expect(api.edit).toHaveBeenCalledOnce();
    expect(nodes(render()).some((item) => item.type === 'form')).toBe(false);
  });

  it('locks double submission, retries an uncertain network failure with the same key, and never retries PATCH after a receipt', async () => {
    await open(); observations(render(), 'Other');
    let reject!: (reason: Error) => void;
    api.edit.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    submit(render()); submit(render()); expect(api.edit).toHaveBeenCalledTimes(1);
    reject(new TypeError('Network unavailable'));
    await vi.waitFor(() => expect(hooks.states[9]).toContain('Network unavailable'));
    submit(render()); await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.edit.mock.calls[1][1]).toEqual(api.edit.mock.calls[0][1]);
    hooks.states = []; hooks.refs = []; onClose.mockReset();
    api.editContext.mockResolvedValue(editContext); onSaved.mockRejectedValueOnce(new Error('Refresh failed'));
    await open(); observations(render(), 'New'); submit(render());
    await vi.waitFor(() => expect(hooks.states[9]).toContain('se guardó, pero no se pudieron actualizar'));
    expect(api.edit).toHaveBeenCalledTimes(3);
    press(button(render(), 'Reintentar actualización'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.edit).toHaveBeenCalledTimes(3); expect(hooks.toast).toHaveBeenCalledTimes(2);
  });

  it('rotates the key after a changed draft and Cancel never sends PATCH', async () => {
    await open(); observations(render(), 'Other');
    api.edit.mockRejectedValueOnce(new TypeError('Network unavailable'));
    submit(render()); await vi.waitFor(() => expect(hooks.states[9]).toContain('Network unavailable'));
    const firstKey = api.edit.mock.calls[0][1].idempotencyKey;
    observations(render(), 'Another'); submit(render());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.edit.mock.calls[1][1].idempotencyKey).not.toBe(firstKey);
    hooks.states = []; hooks.refs = []; api.edit.mockClear(); onClose.mockReset();
    onClose.mockReset(); await open(); press(button(render(), 'Cancelar'));
    expect(onClose).toHaveBeenCalledOnce(); expect(api.edit).not.toHaveBeenCalled();
  });

  it('traps Escape and Tab within the modal and prevents dismissal during a pending mutation', async () => {
    await open();
    let listener!: (event: KeyboardEvent) => void;
    const first = { focus: vi.fn() }, last = { focus: vi.fn() };
    vi.stubGlobal('document', { activeElement: first, addEventListener: vi.fn((_name, fn) => { listener = fn; }), removeEventListener: vi.fn() });
    try {
      hooks.refs[0].current = { querySelectorAll: () => [first, last], contains: () => true, focus: vi.fn() };
      render(); const cleanup = hooks.effects[3]() as unknown as () => void;
      const escape = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      listener(escape); expect(onClose).toHaveBeenCalledOnce(); expect(escape.preventDefault).toHaveBeenCalledOnce();
      onClose.mockReset(); hooks.refs[4].current = true;
      listener(escape); expect(onClose).not.toHaveBeenCalled();
      hooks.refs[4].current = false;
      listener({ key: 'Tab', shiftKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
      expect(last.focus).toHaveBeenCalledOnce(); cleanup();
    } finally { vi.unstubAllGlobals(); }
  });
});
