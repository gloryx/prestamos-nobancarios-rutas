import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RouteNameAlreadyExistsError, RouteNotFoundError } from '../../domain/route/route.errors';
import { ChangeRouteStatusUseCase, CreateRouteUseCase, GetRouteUseCase, ListRoutesUseCase, UpdateRouteUseCase } from '../../application/route/route.use-cases';
import { ChangeRouteStatusDto, CreateRouteDto, UpdateRouteDto } from './route.dto';
import { RequirePermissions } from '../security/security.decorators';

@Controller('routes')
export class RouteController {
  constructor(private readonly list: ListRoutesUseCase, private readonly get: GetRouteUseCase, private readonly create: CreateRouteUseCase, private readonly update: UpdateRouteUseCase, private readonly status: ChangeRouteStatusUseCase) {}
  @Get() @RequirePermissions('routes.view') listAll() { return this.list.execute(); }
  @Get(':id') @RequirePermissions('routes.view') getOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.run(() => this.get.execute(id)); }
  @Post() @RequirePermissions('routes.create') createOne(@Body() body: CreateRouteDto) { return this.run(() => this.create.execute(body)); }
  @Patch(':id') @RequirePermissions('routes.update') updateOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateRouteDto) { return this.run(() => this.update.execute(id, body)); }
  @Patch(':id/status') @RequirePermissions('routes.status.change') changeStatus(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: ChangeRouteStatusDto) { return this.run(() => this.status.execute(id, body.isActive)); }
  private async run<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { if (error instanceof RouteNotFoundError) throw new NotFoundException(error.message); if (error instanceof RouteNameAlreadyExistsError) throw new ConflictException(error.message); if (error instanceof Error) throw new BadRequestException(error.message); throw error; } }
}
