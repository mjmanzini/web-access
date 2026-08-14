import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RulesService } from './rules.service';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';

@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  findAll() {
    return this.rules.findAll();
  }

  /** Instant block/unblock of a domain or category (global or per-profile). */
  @Post()
  create(@Body() dto: CreateRuleDto) {
    return this.rules.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return this.rules.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rules.remove(id);
  }
}
