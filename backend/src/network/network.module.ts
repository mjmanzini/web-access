import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NETWORK_PROVIDER } from './network-provider.interface';
import { AdguardService } from './adguard/adguard.service';

/**
 * Binds the NETWORK_PROVIDER token to a concrete appliance driver. To switch
 * to Pi-hole/OpenWrt later, implement NetworkProvider and swap the class here —
 * nothing else in the app references AdGuard directly. Global so any feature
 * module can inject the provider.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    AdguardService,
    { provide: NETWORK_PROVIDER, useExisting: AdguardService },
  ],
  exports: [NETWORK_PROVIDER],
})
export class NetworkModule {}
