import { Schedule } from '../entities/schedule.entity';
import { SchedulesService } from './schedules.service';

/**
 * The bedtime warning is only useful if it lands BEFORE the internet stops, so
 * the countdown has to be right at the edges: a window that crosses midnight,
 * a window that already started, and day-of-week filters that apply to the day
 * the window STARTS on — not to today.
 */
const at = (hh: number, mm: number, day = 3 /* Wednesday */): Date => {
  const d = new Date(2026, 7, 12, hh, mm, 0, 0); // 2026-08-12 is a Wednesday
  expect(d.getDay()).toBe(day);
  return d;
};

const schedule = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 's1',
    label: 'Bedtime',
    startTime: '20:30',
    endTime: '06:00',
    enabled: true,
    daysOfWeek: [],
    profileId: 'p1',
    ...over,
  }) as Schedule;

describe('SchedulesService.minutesUntilStart', () => {
  it('counts down to tonight’s start', () => {
    expect(SchedulesService.minutesUntilStart(schedule(), at(20, 20))).toBe(10);
  });

  it('is null once the window is already running', () => {
    // 21:00 is inside 20:30→06:00; there is nothing to warn about.
    expect(SchedulesService.minutesUntilStart(schedule(), at(21, 0))).toBeNull();
    // And still inside it after midnight.
    expect(SchedulesService.minutesUntilStart(schedule(), at(2, 0))).toBeNull();
  });

  it('rolls over to tomorrow after the window has ended', () => {
    // 07:00, window ended at 06:00 → next start is 20:30 today, 13.5h away.
    expect(SchedulesService.minutesUntilStart(schedule(), at(7, 0))).toBe(13 * 60 + 30);
  });

  it('fires exactly one minute before, and at the boundary', () => {
    expect(SchedulesService.minutesUntilStart(schedule(), at(20, 29))).toBe(1);
    // At the start minute itself the window is active, so no warning — the
    // block notification takes over.
    expect(SchedulesService.minutesUntilStart(schedule(), at(20, 30))).toBeNull();
  });

  it('applies the day filter to the day the window starts on', () => {
    // Weekdays only (Mon-Fri). Wednesday 20:20 → warn.
    const weekdays = schedule({ daysOfWeek: ['1', '2', '3', '4', '5'] });
    expect(SchedulesService.minutesUntilStart(weekdays, at(20, 20))).toBe(10);

    // Saturday-only window, asked on Wednesday evening → the next start is
    // Thursday's, which is not in the list, so nothing.
    const saturday = schedule({ daysOfWeek: ['6'] });
    expect(SchedulesService.minutesUntilStart(saturday, at(20, 20))).toBeNull();
  });

  it('looks at tomorrow’s day when today’s start has passed', () => {
    // Thursday-only window. On Wednesday at 22:00 the 20:30 start has passed,
    // so the next occurrence is Thursday — which IS in the list.
    const thursday = schedule({ daysOfWeek: ['4'] });
    expect(SchedulesService.minutesUntilStart(thursday, at(22, 0))).toBe(22 * 60 + 30);
  });

  it('ignores a disabled window', () => {
    expect(SchedulesService.minutesUntilStart(schedule({ enabled: false }), at(20, 20))).toBeNull();
  });

  it('handles a same-day window that does not cross midnight', () => {
    const homework = schedule({ startTime: '14:00', endTime: '16:00' });
    expect(SchedulesService.minutesUntilStart(homework, at(13, 50))).toBe(10);
    expect(SchedulesService.minutesUntilStart(homework, at(15, 0))).toBeNull(); // running
  });
});
