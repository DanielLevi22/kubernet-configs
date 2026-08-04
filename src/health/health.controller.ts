import { Controller, Get } from '@nestjs/common';
import  { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService:HealthService) {}

  @Get('healthz')
  healtz(): string {
    return this.healthService.checkHeath();
  }
  @Get('readyz')
  readyz(): string {
    return this.healthService.checkReady();
  }
}
