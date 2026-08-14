import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { Schedule } from '../entities/schedule.entity';

@Controller()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('profiles/:profileId/schedules')
  list(@Param('profileId') profileId: string) {
    return this.schedules.findForProfile(profileId);
  }

  @Post('profiles/:profileId/schedules')
  create(
    @Param('profileId') profileId: string,
    @Body() body: Partial<Schedule>,
  ) {
    return this.schedules.create({ ...body, profileId });
  }

  @Patch('schedules/:id')
  update(@Param('id') id: string, @Body() body: Partial<Schedule>) {
    return this.schedules.update(id, body);
  }

  @Delete('schedules/:id')
  remove(@Param('id') id: string) {
    return this.schedules.remove(id);
  }
}
