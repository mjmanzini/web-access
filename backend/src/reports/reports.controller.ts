import { Controller, Get, Param, Post } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { DigestService } from './digest.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly digest: DigestService,
  ) {}

  @Get()
  all() {
    return this.reports.forAll();
  }

  @Get('profile/:id')
  profile(@Param('id') id: string) {
    return this.reports.forProfile(id);
  }

  /** Compose + send the weekly digest now (also returns the text). */
  @Post('digest')
  sendDigest() {
    return this.digest.sendNow();
  }
}
