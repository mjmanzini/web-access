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

  @Post()
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
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
