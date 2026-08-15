import { effectiveState, EffectiveInput } from './effective-state';

const base: EffectiveInput = {
  internetSwitch: 'auto',
  bedtimeEnabled: true,
  inBedtimeWindow: false,
};

describe('effective internet state', () => {
  describe('the two switches, every combination', () => {
    it('manual OFF + bedtime active → blocked by the switch, not bedtime', () => {
      const s = effectiveState({ ...base, internetSwitch: 'off', inBedtimeWindow: true });
      expect(s).toMatchObject({ blocked: true, cause: 'manual' });
    });

    it('manual OFF + bedtime disabled → still blocked', () => {
      const s = effectiveState({ ...base, internetSwitch: 'off', bedtimeEnabled: false });
      expect(s).toMatchObject({ blocked: true, cause: 'manual' });
    });

    it('manual OFF outside any window → still blocked (no expiry)', () => {
      const s = effectiveState({ ...base, internetSwitch: 'off', inBedtimeWindow: false });
      expect(s).toMatchObject({ blocked: true, cause: 'manual' });
    });

    it('AUTO + bedtime enabled + window active → blocked by bedtime', () => {
      const s = effectiveState({ ...base, inBedtimeWindow: true, bedtimeEndsAt: '06:00' });
      expect(s).toMatchObject({ blocked: true, cause: 'bedtime' });
      expect(s.summary).toBe('Off — bedtime until 06:00');
    });

    it('AUTO + bedtime DISABLED + window active → allowed (the whole point of the switch)', () => {
      const s = effectiveState({ ...base, bedtimeEnabled: false, inBedtimeWindow: true });
      expect(s).toMatchObject({ blocked: false, cause: null, summary: 'On' });
    });

    it('AUTO + bedtime enabled + no window → allowed', () => {
      expect(effectiveState(base)).toMatchObject({ blocked: false, cause: null });
    });
  });

  describe('quota interplay', () => {
    it('quota blocks when auto and no bedtime running', () => {
      const s = effectiveState({ ...base, dailyLimitMinutes: 60, usedMinutes: 60 });
      expect(s).toMatchObject({ blocked: true, cause: 'quota' });
    });

    it('bonus time raises the allowance', () => {
      const s = effectiveState({ ...base, dailyLimitMinutes: 60, usedMinutes: 65, bonusMinutes: 15 });
      expect(s).toMatchObject({ blocked: false, cause: null });
    });

    it('bedtime outranks quota, so the reason shown is the one that started first', () => {
      const s = effectiveState({
        ...base,
        inBedtimeWindow: true,
        bedtimeEndsAt: '06:00',
        dailyLimitMinutes: 4,
        usedMinutes: 999,
      });
      expect(s.cause).toBe('bedtime');
    });

    it('manual OFF outranks quota too', () => {
      const s = effectiveState({
        ...base,
        internetSwitch: 'off',
        dailyLimitMinutes: 4,
        usedMinutes: 999,
      });
      expect(s.cause).toBe('manual');
    });

    it('no limit set means quota never blocks', () => {
      const s = effectiveState({ ...base, dailyLimitMinutes: null, usedMinutes: 10_000 });
      expect(s).toMatchObject({ blocked: false });
    });

    it('under the limit is allowed', () => {
      const s = effectiveState({ ...base, dailyLimitMinutes: 60, usedMinutes: 59 });
      expect(s).toMatchObject({ blocked: false });
    });
  });

  describe('summaries are readable without further explanation', () => {
    it.each([
      [{ internetSwitch: 'off' as const }, 'Off — switched off by parent'],
      [{ inBedtimeWindow: true, bedtimeEndsAt: '06:00' }, 'Off — bedtime until 06:00'],
      [{ dailyLimitMinutes: 30, usedMinutes: 30 }, 'Off — daily limit reached (30 min)'],
      [{}, 'On'],
    ])('%o → %s', (patch, expected) => {
      expect(effectiveState({ ...base, ...patch }).summary).toBe(expected);
    });
  });
});
