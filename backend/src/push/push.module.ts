import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from '../entities/push-subscription.entity';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Global so EventsGateway can push alerts without a circular import back
 * through the feature modules that raise them.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
