import 'reflect-metadata';
import { type ExecutionContext, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ListCantonsUseCase, ListDistrictsUseCase, ListProvincesUseCase } from '../src/application/territorial/territorial.use-cases';
import type { TerritorialRepository } from '../src/application/territorial/territorial.repository';
import { TerritorialController } from '../src/presentation/territorial/territorial.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PermissionGuard } from '../src/presentation/security/permission.guard';

describe('territorial read-only application', () => {
  const repository: jest.Mocked<TerritorialRepository> = {
    findProvinces: jest.fn().mockResolvedValue([]),
    findCantons: jest.fn().mockResolvedValue([]),
    findDistricts: jest.fn().mockResolvedValue([]),
  };

  it('passes province filters to the canton query', async () => {
    await new ListCantonsUseCase(repository).execute(5);
    expect(repository.findCantons).toHaveBeenCalledWith({ provinceCode: 5 });
  });

  it('passes both hierarchy filters to the district query', async () => {
    await new ListDistrictsUseCase(repository).execute({ provinceCode: 6, cantonCode: 603 });
    expect(repository.findDistricts).toHaveBeenCalledWith({ provinceCode: 6, cantonCode: 603 });
  });

  it('keeps province listing independent from persistence details', async () => {
    await new ListProvincesUseCase(repository).execute();
    expect(repository.findProvinces).toHaveBeenCalledTimes(1);
  });

  it('exposes only GET territorial controller handlers', () => {
    const methods = ['getProvinces', 'getCantons', 'getProvinceCantons', 'getDistricts', 'getCantonDistricts'];
    expect(methods.every((method) => Reflect.getMetadata('method', TerritorialController.prototype[method as keyof TerritorialController]) === RequestMethod.GET)).toBe(true);
    expect(Reflect.ownKeys(TerritorialController.prototype)).not.toContain('post');
  });

  it('allows collector workspace readers to load dependent territorial filters', () => {
    for (const method of ['getCantons', 'getDistricts'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, TerritorialController.prototype[method])).toEqual(['territorial.view', 'collectors.view']);
    }
  });

  it('authorizes both territorial and collector readers through the central guard', () => {
    const guard = new PermissionGuard(new Reflector());
    const context = (method: 'getCantons' | 'getDistricts', permissions: string[]) => ({
      getHandler: () => TerritorialController.prototype[method],
      getClass: () => TerritorialController,
      switchToHttp: () => ({ getRequest: () => ({ currentUser: { role: { isSuperAdmin: false }, permissions } }) }),
    }) as unknown as ExecutionContext;

    expect(guard.canActivate(context('getCantons', ['collectors.view']))).toBe(true);
    expect(guard.canActivate(context('getDistricts', ['territorial.view']))).toBe(true);
  });
});
