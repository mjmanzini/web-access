import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ROUTER_PROVIDER } from './router-provider.interface';
import { NullRouterProvider } from './null-router.provider';
import { OpenWrtService } from './openwrt/openwrt.service';
import { HuaweiLteService } from './huawei/huawei.service';
import { RouterController } from './router.controller';

/**
 * Binds ROUTER_PROVIDER by the ROUTER_PROVIDER env value:
 *   'openwrt' → OpenWrtService  (full: firewall cutoffs, bandwidth, containment)
 *   'huawei'  → HuaweiLteService (partial: discovery + Wi-Fi MAC-block cutoff)
 *   else      → NullRouterProvider (no-op; AdGuard-only setups)
 * Global so enforcement/discovery/bandwidth code can inject it uniformly. Add a
 * new router by implementing RouterProvider and extending this factory.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RouterController],
  providers: [
    OpenWrtService,
    HuaweiLteService,
    NullRouterProvider,
    {
      provide: ROUTER_PROVIDER,
      inject: [ConfigService, OpenWrtService, HuaweiLteService, NullRouterProvider],
      useFactory: (
        config: ConfigService,
        openwrt: OpenWrtService,
        huawei: HuaweiLteService,
        nul: NullRouterProvider,
      ) => {
        switch (config.get<string>('ROUTER_PROVIDER', 'none')) {
          case 'openwrt':
            return openwrt;
          case 'huawei':
            return huawei;
          default:
            return nul;
        }
      },
    },
  ],
  exports: [ROUTER_PROVIDER],
})
export class RouterModule {}
