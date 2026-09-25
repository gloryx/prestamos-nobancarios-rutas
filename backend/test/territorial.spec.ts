import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ListCantonsUseCase, ListDistrictsUseCase, ListProvincesUseCase } from '../src/application/territorial/territorial.use-cases';
import type { TerritorialRepository } from '../src/application/territorial/territorial.repository';
import { TerritorialController } from '../src/presentation/territorial/territorial.controller';

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
});
