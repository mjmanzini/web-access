import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rule } from '../entities/rule.entity';
import { Profile } from '../entities/profile.entity';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [TypeOrmModule.forFeature([Rule, Profile]), ProfilesModule],
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
