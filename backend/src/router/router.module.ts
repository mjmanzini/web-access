import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ROUTER_PROVIDER } from './router-provider.interface';
import { NullRouterProvider } from './null-router.provider';
import { OpenWrtService } from './openwrt/openwrt.service';
import { RouterController } from './router.controller';

/**
 * Binds ROUTER_PROVIDER by ROUTER_PROVIDER env: 'openwrt' → OpenWrtService, any
 * other value (default) → NullRouterProvider (no-op). Global so the enforcement,
 * discovery, and bandwidth code can inject it without caring whether a router is
 * actually configured. Add new routers (pfSense, EdgeOS, …) by implementing
 * RouterProvider and extending the factory here.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RouterController],
  providers: [
    OpenWrtService,
    NullRouterProvider,
    {
      provide: ROUTER_PROVIDER,
      inject: [ConfigService, OpenWrtService, NullRouterProvider],
      useFactory: (
        config: ConfigService,
        openwrt: OpenWrtService,
        nul: NullRouterProvider,
      ) =>
        config.get<string>('ROUTER_PROVIDER', 'none') === 'openwrt'
          ? openwrt
          : nul,
    },
  ],
  exports: [ROUTER_PROVIDER],
})
export class RouterModule {}
