import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { NetworkModule } from './network/network.module';
import { RouterModule } from './router/router.module';
import { EventsModule } from './events/events.module';
import { ProfilesModule } from './profiles/profiles.module';
import { DevicesModule } from './devices/devices.module';
import { RulesModule } from './rules/rules.module';
import { ActivityModule } from './activity/activity.module';
import { BandwidthModule } from './bandwidth/bandwidth.module';
import { RequestsModule } from './requests/requests.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';
import { SchedulesModule } from './schedules/schedules.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    ScheduleModule.forRoot(),
    // Infrastructure (global): auth, network + router providers, realtime events.
    AuthModule,
    NetworkModule,
    RouterModule,
    EventsModule,
    // Features.
    ProfilesModule,
    DevicesModule,
    RulesModule,
    ActivityModule,
    BandwidthModule,
    RequestsModule,
    ReportsModule,
    HealthModule,
    SchedulesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
