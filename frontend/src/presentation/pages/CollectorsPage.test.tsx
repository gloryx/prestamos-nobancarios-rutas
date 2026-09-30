import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collector } from '../../domain/entities/collector';
import type { AuthIdentity } from '../../domain/entities/auth';
import { ListCollectors } from '../../application/use-cases/collector.use-cases';
import { collectorUseCases } from '../../app/collectors';
import { apiClient } from '../../infrastructure/api/api-client';
import { TableActions } from '../components/TableActions';
import { canAccess } from '../hooks/auth-permissions';
import { CollectorsPage } from './CollectorsPage';

const harness = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: boolean }[], index: 0, refIndex: 0, effect: undefined as (() => void) | undefined,
  identity: undefined as AuthIdentity | undefined, files: [] as { filename: string; contents: string }[], failSave: false,
}));
vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: (callback: () => void) => { harness.effect = callback; },
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(harness.values[index]) : next; }];
  },
  useRef: (initial: boolean) => {
    const index = harness.refIndex++;
    return harness.refs[index] ??= { current: initial };
  },
}));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: (code: string) => canAccess(harness.identity, code) }) }));
vi.mock('jspdf', async (importOriginal) => {
  const original = await importOriginal<typeof import('jspdf')>();
  return { ...original, jsPDF: class extends original.jsPDF {
    constructor(...args: ConstructorParameters<typeof original.jsPDF>) { super(...args); this.save = ((filename: string) => {
      if (harness.failSave) throw new Error('Save failed');
      harness.files.push({ filename, contents: this.output() }); return this;
    }) as unknown as typeof this.save; }
  } };
});

const collector = (index: number): Collector => ({
  id: `private-${index}`, identification: `ID-${index}`, firstName: 'Ana', firstLastName: `Muñoz${index}`, phone: '8888-8888',
  birthDate: '1990-01-01', address: 'San José', userId: null, user: null, isActive: index % 2 === 0,
});
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';
const render = () => { harness.index = 0; harness.refIndex = 0; return CollectorsPage(); };
const button = () => {
  const found = elements(render()).find((element) => element.type === 'button' && 'aria-busy' in (element.props as object));
  if (!found) throw new Error('Missing PDF button');
  return found.props as { type: string; className: string; disabled: boolean; 'aria-busy': boolean; onClick: () => void; children: ReactNode };
};
const alert = () => elements(render()).filter((element) => (element.props as { role?: string }).role === 'alert').map((element) => text(element)).join(' ');
const startList = async (items: Collector[] = [collector(0)]) => {
  const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items, total: items.length, pages: items.length ? 1 : 0 });
  render(); harness.effect!();
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  return request;
};

describe('collector list PDF export', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    harness.values = []; harness.refs = []; harness.files = []; harness.failSave = false; harness.effect = undefined;
    harness.identity = { id: 'user', username: 'user', fullName: 'User', role: { id: 'role', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: ['collectors.view'] };
  });

  it('gates export via centralized view permission, including superadmin, without removing existing controls', async () => {
    harness.identity = { ...harness.identity!, permissions: ['collectors.create'] };
    expect(elements(render()).some((element) => element.type === 'button' && text((element.props as { children?: ReactNode }).children) === 'Exportar PDF')).toBe(false);
    expect(elements(render()).some((element) => element.type === 'button' && text((element.props as { children?: ReactNode }).children) === 'Nuevo cobrador')).toBe(true);
    harness.identity = { ...harness.identity, role: { ...harness.identity.role, isSuperAdmin: true }, permissions: [] };
    expect(canAccess(harness.identity, 'collectors.view')).toBe(true);
    expect(button()).toMatchObject({ type: 'button', className: 'button button--secondary', disabled: true, 'aria-busy': false });
    const request = await startList();
    expect(collectorUseCases.list).toBeInstanceOf(ListCollectors);
    expect(elements(render()).find((element) => element.type === TableActions)?.props).toMatchObject({
      actions: expect.arrayContaining([expect.objectContaining({ key: 'edit' }), expect.objectContaining({ key: 'status' })]),
    });
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/collectors?search=&status=ACTIVE&page=1&pageSize=10', '/collectors?search=&status=ACTIVE&page=1&pageSize=50',
    ]);
    expect(harness.files[0].contents).toContain('%PDF-');
  });

  it('exports the displayed criteria, not a draft search, then tracks a successfully loaded status/search change', async () => {
    const request = await startList();
    const search = elements(render()).find((element) => element.type === 'input')!;
    (search.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'Muñoz' } });
    expect(request).toHaveBeenCalledOnce();
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(request.mock.calls[1][0]).toBe('/collectors?search=&status=ACTIVE&page=1&pageSize=50');
    request.mockResolvedValueOnce({ items: [collector(1)], total: 1, pages: 1 });
    const status = elements(render()).find((element) => element.type === 'select')!;
    (status.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'INACTIVE' } });
    render(); harness.effect!();
    await vi.waitFor(() => expect(elements(render()).some((element) => element.type === 'td' && text(element) === 'ID-1')).toBe(true));
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(2));
    expect(request.mock.calls.slice(2).map(([url]) => url)).toEqual([
      '/collectors?search=Mu%C3%B1oz&status=INACTIVE&page=1&pageSize=10',
      '/collectors?search=Mu%C3%B1oz&status=INACTIVE&page=1&pageSize=50',
    ]);
    expect(harness.files[1].contents).toContain('Inactivos');
  });

  it('keeps the previously displayed filters during an in-flight list reload', async () => {
    const request = await startList();
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise((done) => { resolve = done; }) as never);
    const status = elements(render()).find((element) => element.type === 'select')!;
    (status.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value: 'INACTIVE' } });
    render(); harness.effect!();
    expect(button().disabled).toBe(false);
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(request.mock.calls[2][0]).toBe('/collectors?search=&status=ACTIVE&page=1&pageSize=50');
    resolve({ items: [collector(1)], total: 1, pages: 1 });
    await vi.waitFor(() => expect(elements(render()).some((element) => element.type === 'td' && text(element) === 'ID-1')).toBe(true));
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(2));
    expect(request.mock.calls[3][0]).toBe('/collectors?search=&status=INACTIVE&page=1&pageSize=50');
  });

  it('reads 50 + 50 + 1 via only three exact filtered GETs with a live use-case receiver before saving', async () => {
    const request = await startList();
    request.mockImplementation(async (path) => {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return { items: Array.from({ length: page === 3 ? 1 : 50 }, (_, index) => collector((page - 1) * 50 + index)), total: 101, pages: 3 } as never;
    });
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(request.mock.calls.slice(1).map(([path, options]) => [path, options])).toEqual([1, 2, 3].map((page) => [
      `/collectors?search=&status=ACTIVE&page=${page}&pageSize=50`, undefined,
    ]));
    expect(harness.files[0].filename).toMatch(/^cobradores-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(harness.files[0].contents).toContain('Lista de cobradores');
    expect(harness.files[0].contents).toContain('Identificación');
    expect(harness.files[0].contents).toContain('Muñoz100');
    expect(harness.files[0].contents).toContain('ID-100');
    expect(harness.files[0].contents).not.toContain('private-100');
  });

  it('shows a visible empty notice instead of saving an empty PDF', async () => {
    const request = await startList([]);
    button().onClick();
    await vi.waitFor(() => expect(alert()).toContain('No hay cobradores para exportar.'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(harness.files).toHaveLength(0);
    expect(button()).toMatchObject({ disabled: false, 'aria-busy': false });
  });

  it('blocks immediate duplicate clicks and aborts after a later-page error, then allows retry', async () => {
    const request = await startList();
    let reject!: (reason: Error) => void;
    const pending = new Promise<never>((_, fail) => { reject = fail; });
    request.mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, index) => collector(index)), total: 51, pages: 2 });
    request.mockReturnValueOnce(pending);
    const first = button(); first.onClick(); first.onClick(); button().onClick();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(button()).toMatchObject({ disabled: true, 'aria-busy': true });
    expect(text(button().children)).toBe('Exportando…');
    expect(elements(render()).some((element) => element.type === 'select')).toBe(true);
    reject(new Error('Later page unavailable'));
    await vi.waitFor(() => expect(alert()).toContain('No fue posible exportar los cobradores a PDF.'));
    expect(harness.files).toHaveLength(0);
    expect(button()).toMatchObject({ disabled: false, 'aria-busy': false });
    request.mockResolvedValue({ items: [collector(0)], total: 1, pages: 1 });
    button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(alert()).toBe('');
  });

  it('surfaces a PDF writer failure, clears busy state, and permits another attempt', async () => {
    await startList(); harness.failSave = true;
    button().onClick();
    await vi.waitFor(() => expect(alert()).toContain('No fue posible exportar los cobradores a PDF.'));
    expect(harness.files).toHaveLength(0);
    expect(button()).toMatchObject({ disabled: false, 'aria-busy': false });
    harness.failSave = false; button().onClick();
    await vi.waitFor(() => expect(harness.files).toHaveLength(1));
    expect(alert()).toBe('');
  });
});
