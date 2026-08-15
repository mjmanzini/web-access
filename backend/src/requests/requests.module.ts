import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessRequest } from '../entities/access-request.entity';
import { Device } from '../entities/device.entity';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { RequestPageController } from './request-page.controller';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccessRequest, Device]), RulesModule],
  controllers: [RequestsController, RequestPageController],
  providers: [RequestsService],
})
export class RequestsModule {}
