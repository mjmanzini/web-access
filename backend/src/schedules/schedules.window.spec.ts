import { Schedule } from '../entities/schedule.entity';
import { SchedulesService } from './schedules.service';

function makeSchedule(over: Partial<Schedule>): Schedule {
  return {
    id: 's1',
    label: 'Bedtime',
    daysOfWeek: ['0', '1', '2', '3', '4', '5', '6'],
    startTime: '20:00',
    endTime: '06:00',
    enabled: true,
    profileId: 'p1',
    profile: undefined as never,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Build a Date at a fixed local weekday/time for deterministic checks. */
function at(day: number, hh: number, mm: number): Date {
  // 2024-01-07 is a Sunday; add `day` to land on the desired weekday.
  const d = new Date(2024, 0, 7 + day, hh, mm, 0, 0);
  return d;
}

describe('SchedulesService.isActive', () => {
  it('treats a cross-midnight bedtime window correctly', () => {
    const s = makeSchedule({ startTime: '20:00', endTime: '06:00' });
    expect(SchedulesService.isActive(s, at(1, 22, 0))).toBe(true); // 22:00 inside
    expect(SchedulesService.isActive(s, at(1, 5, 30))).toBe(true); // 05:30 inside
    expect(SchedulesService.isActive(s, at(1, 12, 0))).toBe(false); // noon outside
  });

  it('respects a same-day window', () => {
    const s = makeSchedule({ startTime: '09:00', endTime: '17:00' });
    expect(SchedulesService.isActive(s, at(2, 12, 0))).toBe(true);
    expect(SchedulesService.isActive(s, at(2, 8, 0))).toBe(false);
    expect(SchedulesService.isActive(s, at(2, 17, 0))).toBe(false); // end exclusive
  });

  it('honors day-of-week filtering and the enabled flag', () => {
    const weekdaysOnly = makeSchedule({ daysOfWeek: ['1', '2', '3', '4', '5'] });
    expect(SchedulesService.isActive(weekdaysOnly, at(0, 22, 0))).toBe(false); // Sunday
    expect(SchedulesService.isActive(weekdaysOnly, at(1, 22, 0))).toBe(true); // Monday
    expect(SchedulesService.isActive(makeSchedule({ enabled: false }), at(1, 22, 0))).toBe(false);
  });
});
