import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListCantonsUseCase, ListDistrictsUseCase, ListProvincesUseCase } from '../../application/territorial/territorial.use-cases';
import { OptionalPositiveIntPipe } from './territorial.dto';
import { RequirePermissions } from '../security/security.decorators';

@Controller('territorial')
export class TerritorialController {
  constructor(private readonly listProvinces: ListProvincesUseCase, private readonly listCantons: ListCantonsUseCase, private readonly listDistricts: ListDistrictsUseCase) {}
  @Get('provinces') @RequirePermissions('territorial.view') getProvinces() { return this.listProvinces.execute(); }
  @Get('cantons') @RequirePermissions('territorial.view') getCantons(@Query('provinceCode', OptionalPositiveIntPipe) provinceCode?: number) { return this.listCantons.execute(provinceCode); }
  @Get('provinces/:provinceCode/cantons') @RequirePermissions('territorial.view') getProvinceCantons(@Param('provinceCode', OptionalPositiveIntPipe) provinceCode: number) { return this.listCantons.execute(provinceCode); }
  @Get('districts') @RequirePermissions('territorial.view') getDistricts(@Query('provinceCode', OptionalPositiveIntPipe) provinceCode?: number, @Query('cantonCode', OptionalPositiveIntPipe) cantonCode?: number) { return this.listDistricts.execute({ provinceCode, cantonCode }); }
  @Get('cantons/:cantonCode/districts') @RequirePermissions('territorial.view') getCantonDistricts(@Param('cantonCode', OptionalPositiveIntPipe) cantonCode: number) { return this.listDistricts.execute({ cantonCode }); }
}
