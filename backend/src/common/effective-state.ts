/**
 * The single place that decides whether a profile has internet.
 *
 * Two independent switches a parent controls, and two automatic conditions:
 *
 *   internetSwitch   'off'  → blocked, always. Automation never touches it.
 *                    'auto' → the schedule and quota decide.
 *   bedtimeEnabled   false  → bedtime windows are ignored entirely.
 *                    true   → an active window blocks (when the switch is auto).
 *
 * Precedence is fixed and total: manual OFF > bedtime > quota > allowed. There
 * is no expiry, no override and no stickiness beyond the switches themselves —
 * whatever the switches say now is what is true now. That predictability is the
 * point: the previous model layered a manual pause, an automatic pause and a
 * timed override on top of each other, and no one could say what state a
 * profile was in or why.
 */

export type InternetSwitch = 'auto' | 'off';
export type BlockCause = 'manual' | 'bedtime' | 'quota' | null;

export interface EffectiveInput {
  internetSwitch: InternetSwitch;
  bedtimeEnabled: boolean;
  /** True when a bedtime window is running right now. */
  inBedtimeWindow: boolean;
  /** When the running window ends, for display ("off until 06:00"). */
  bedtimeEndsAt?: string | null;
  dailyLimitMinutes?: number | null;
  usedMinutes?: number;
  bonusMinutes?: number;
}

export interface EffectiveState {
  blocked: boolean;
  cause: BlockCause;
  /** One line a parent (or child) can read without further explanation. */
  summary: string;
}

export function effectiveState(input: EffectiveInput): EffectiveState {
  if (input.internetSwitch === 'off') {
    return { blocked: true, cause: 'manual', summary: 'Off — switched off by parent' };
  }

  if (input.bedtimeEnabled && input.inBedtimeWindow) {
    return {
      blocked: true,
      cause: 'bedtime',
      summary: input.bedtimeEndsAt
        ? `Off — bedtime until ${input.bedtimeEndsAt}`
        : 'Off — bedtime',
    };
  }

  const limit = input.dailyLimitMinutes;
  if (limit != null) {
    const allowance = limit + (input.bonusMinutes ?? 0);
    if ((input.usedMinutes ?? 0) >= allowance) {
      return {
        blocked: true,
        cause: 'quota',
        summary: `Off — daily limit reached (${allowance} min)`,
      };
    }
  }

  return { blocked: false, cause: null, summary: 'On' };
}
