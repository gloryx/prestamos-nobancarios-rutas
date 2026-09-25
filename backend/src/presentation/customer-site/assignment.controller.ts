import { Body, Controller, ForbiddenException, NotFoundException, ConflictException, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CustomerSiteUseCases } from '../../application/customer-site/customer-site.use-cases';
import { CustomerSiteConflictError, CustomerSiteForbiddenError, CustomerSiteNotFoundError } from '../../domain/customer-site/customer-site.errors';
const handle = (error: unknown): never => { if (error instanceof CustomerSiteNotFoundError) throw new NotFoundException(error.message); if (error instanceof CustomerSiteForbiddenError) throw new ForbiddenException(error.message); if (error instanceof CustomerSiteConflictError) throw new ConflictException(error.message); throw error; };
@Controller('route-assignments') export class AssignmentController {
  constructor(private readonly useCases: CustomerSiteUseCases) {}
  @Get('options') @RequirePermissions('routes.assign.customers', 'routes.assign.collectors') async options(@CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.routeAssignmentOptions(actor); } catch (error) { return handle(error); } }
  @Post('customers') @RequirePermissions('routes.assign.customers') async assignCustomer(@Body() body: { customerId: string; routeId: string }, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.assignCustomer(body.customerId, body.routeId, actor); } catch (error) { return handle(error); } }
  @Post('collectors') @RequirePermissions('routes.assign.collectors') async assignCollector(@Body() body: { collectorUserId: string; routeId: string }, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.assignCollector(body.routeId, body.collectorUserId, actor); } catch (error) { return handle(error); } }
  @Patch('customers/:id/end') @RequirePermissions('routes.assign.customers') async endCustomer(@Param('id') id: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.endCustomerAssignment(id, actor); } catch (error) { return handle(error); } }
  @Patch('collectors/:id/end') @RequirePermissions('routes.assign.collectors') async endCollector(@Param('id') id: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.endCollectorAssignment(id, actor); } catch (error) { return handle(error); } }
}
