import { QueryFailedError, Repository } from 'typeorm';
import { RouteNameAlreadyExistsError } from '../../../../domain/route/route.errors';
import type { Route } from '../../../../domain/route/route.types';
import type { CreateRoute, RouteRepository, UpdateRoute } from '../../../../application/route/route.repository';
import { RouteOrmEntity } from '../entities';

export class RouteTypeOrmRepository implements RouteRepository {
  constructor(private readonly repository: Repository<RouteOrmEntity>) {}
  private map(row: RouteOrmEntity): Route { return { id: row.id, name: row.name, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  async findAll(): Promise<Route[]> { const rows = await this.repository.createQueryBuilder('route').orderBy('route.name', 'ASC').getMany(); return rows.map((row) => this.map(row)); }
  async findById(id: string): Promise<Route | null> { const row = await this.repository.findOneBy({ id }); return row ? this.map(row) : null; }
  async create(input: CreateRoute): Promise<Route> { try { return this.map(await this.repository.save(this.repository.create({ name: input.name, isActive: true }))); } catch (error) { this.throwDuplicate(error); throw error; } }
  async update(id: string, input: UpdateRoute): Promise<Route | null> { try { const row = await this.repository.preload({ id, ...(input.name === undefined ? {} : { name: input.name }) }); return row ? this.map(await this.repository.save(row)) : null; } catch (error) { this.throwDuplicate(error); throw error; } }
  async updateStatus(id: string, isActive: boolean): Promise<Route | null> { const row = await this.repository.preload({ id, isActive }); return row ? this.map(await this.repository.save(row)) : null; }
  private throwDuplicate(error: unknown): void { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new RouteNameAlreadyExistsError(); }
}
