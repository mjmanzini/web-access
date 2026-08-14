import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import {
  CreateProfileDto,
  PauseProfileDto,
  UpdateProfileDto,
} from './dto/profile.dto';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  findAll() {
    return this.profiles.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profiles.findOne(id);
  }

  /** One-tap pause/resume for every profile (e.g. "dinner time"). */
  @Post('pause-all')
  pauseAll(@Body() body: { paused: boolean }) {
    return this.profiles.pauseAll(!!body.paused);
  }

  @Post()
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
  }

  /** Grant extra minutes for today (lifts a quota pause if active). */
  @Post(':id/bonus-time')
  bonusTime(@Param('id') id: string, @Body() body: { minutes: number }) {
    return this.profiles.grantBonusTime(id, Number(body.minutes) || 0);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(id, dto);
  }

  /** Instant pause/resume ("bedtime now", "back on"). */
  @Post(':id/pause')
  pause(@Param('id') id: string, @Body() dto: PauseProfileDto) {
    return this.profiles.setPaused(id, dto);
  }

  /** Force a re-push of this profile's policy to the network layer. */
  @Post(':id/sync')
  async sync(@Param('id') id: string) {
    await this.profiles.syncProfile(id);
    return { ok: true };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.profiles.remove(id);
  }
}
