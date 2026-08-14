import { Controller, Get, Inject } from '@nestjs/common';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from './network/network-provider.interface';

/** Health + network-appliance status for the dashboard's status card. */
@Controller()
export class AppController {
  constructor(
    @Inject(NETWORK_PROVIDER) private readonly network: NetworkProvider,
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'home-guardian', time: new Date().toISOString() };
  }

  @Get('network/status')
  async networkStatus() {
    return this.network.getStatus();
  }
}
