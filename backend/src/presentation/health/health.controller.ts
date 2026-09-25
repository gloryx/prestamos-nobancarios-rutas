import { Controller, Get } from '@nestjs/common';
import { Public } from '../security/security.decorators';

@Controller('health')
export class HealthController {
  @Get() @Public()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
