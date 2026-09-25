import { ChangeRouteStatusUseCase, CreateRouteUseCase, GetRouteUseCase, ListRoutesUseCase, UpdateRouteUseCase } from '../src/application/route/route.use-cases';
import type { CreateRoute, RouteRepository, UpdateRoute } from '../src/application/route/route.repository';
import type { Route } from '../src/domain/route/route.types';
import { RouteNameAlreadyExistsError } from '../src/domain/route/route.errors';
import { RouteController } from '../src/presentation/route/route.controller';

const item = (id: string, name: string, isActive = true): Route => ({ id, name, isActive, createdAt: new Date(), updatedAt: new Date() });
class FakeRouteRepository implements RouteRepository {
  rows = [item('2', 'Zona Norte'), item('1', 'Centro', false)];
  async findAll() { return [...this.rows].sort((a, b) => a.name.localeCompare(b.name)); }
  async findById(id: string) { return this.rows.find((row) => row.id === id) ?? null; }
  async create(input: CreateRoute) { if (this.rows.some((row) => row.name.toLowerCase() === input.name.toLowerCase())) throw new RouteNameAlreadyExistsError(); const created = item('3', input.name); this.rows.push(created); return created; }
  async update(id: string, input: UpdateRoute) { const row = await this.findById(id); if (!row) return null; if (input.name) row.name = input.name; return row; }
  async updateStatus(id: string, isActive: boolean) { const row = await this.findById(id); if (!row) return null; row.isActive = isActive; return row; }
}

describe('route use cases', () => {
  it('lists by name and gets a route', async () => { const repository = new FakeRouteRepository(); expect((await new ListRoutesUseCase(repository).execute()).map((row) => row.name)).toEqual(['Centro', 'Zona Norte']); expect((await new GetRouteUseCase(repository).execute('1')).name).toBe('Centro'); });
  it('creates and updates routes while trimming names', async () => { const repository = new FakeRouteRepository(); const created = await new CreateRouteUseCase(repository).execute({ name: '  Zona Sur  ' }); expect(created.name).toBe('Zona Sur'); await new UpdateRouteUseCase(repository).execute(created.id, { name: ' Sur ' }); expect((await repository.findById(created.id))?.name).toBe('Sur'); });
  it('rejects blank and duplicate names and exposes no delete endpoint', async () => { const repository = new FakeRouteRepository(); const { validate } = await import('class-validator'); const { plainToInstance } = await import('class-transformer'); const { CreateRouteDto } = await import('../src/presentation/route/route.dto'); expect((await validate(plainToInstance(CreateRouteDto, { name: '   ' }))).length).toBeGreaterThan(0); await expect(new CreateRouteUseCase(repository).execute({ name: ' centro ' })).rejects.toBeInstanceOf(RouteNameAlreadyExistsError); expect(Object.getOwnPropertyNames(RouteController.prototype)).not.toContain('deleteOne'); });
  it('deactivates and reactivates without deleting', async () => { const repository = new FakeRouteRepository(); const useCase = new ChangeRouteStatusUseCase(repository); await useCase.execute('2', false); await useCase.execute('2', true); expect((await repository.findById('2'))?.isActive).toBe(true); expect(repository.rows).toHaveLength(2); });
});
