import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/** Global so any service can inject EventsGateway to raise alerts. */
@Global()
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
