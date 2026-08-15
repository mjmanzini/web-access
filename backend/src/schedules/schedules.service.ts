import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule } from '../entities/schedule.entity';

/** CRUD for recurring block windows (bedtime, homework hours, etc.). */
@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(Schedule) private schedules: Repository<Schedule>,
  ) {}

  findForProfile(profileId: string): Promise<Schedule[]> {
    return this.schedules.find({ where: { profileId } });
  }

  create(data: Partial<Schedule>): Promise<Schedule> {
    return this.schedules.save(this.schedules.create(data));
  }

  async update(id: string, data: Partial<Schedule>): Promise<Schedule> {
    const s = await this.schedules.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    Object.assign(s, data);
    return this.schedules.save(s);
  }

  async remove(id: string): Promise<void> {
    await this.schedules.delete(id);
  }

  /**
   * Is `now` inside this schedule's window? Handles windows that cross midnight
   * (start > end) and day-of-week filtering. `now` is local server time.
   */
  /**
   * When the currently-active window ends, as an absolute time. Used to decide
   * how long a parent's manual override should last: until the restriction
   * would have lifted anyway, not forever and not for one minute.
   */
  static endsAt(schedule: Schedule, now: Date): Date {
    const [sh, sm] = schedule.startTime.split(':').map(Number);
    const [eh, em] = schedule.endTime.split(':').map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    const at = new Date(now);
    at.setSeconds(0, 0);
    at.setHours(eh, em);
    // A window that crosses midnight and is running past its start time ends
    // tomorrow (21:00->06:00 entered at 22:00 ends at 06:00 the next day).
    if (start > end && cur >= start) at.setDate(at.getDate() + 1);
    return at;
  }

  static isActive(schedule: Schedule, now: Date): boolean {
    if (!schedule.enabled) return false;
    const dow = now.getDay();
    const days = (schedule.daysOfWeek ?? []).map(Number);
    if (days.length && !days.includes(dow)) return false;

    const [sh, sm] = schedule.startTime.split(':').map(Number);
    const [eh, em] = schedule.endTime.split(':').map(Number);
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    return start <= end
      ? cur >= start && cur < end // same-day window
      : cur >= start || cur < end; // crosses midnight
  }
}
