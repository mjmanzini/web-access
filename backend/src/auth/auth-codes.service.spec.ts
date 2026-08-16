import { AuthCodesService } from './auth-codes.service';
import { AuthCode } from '../entities/auth-code.entity';

/**
 * A 6-digit code is one guess in a million. That is only safe because of what
 * surrounds it, so these tests are about the surroundings: single use, expiry,
 * a hard attempt ceiling, and never storing the code itself.
 */
describe('AuthCodesService', () => {
  /** In-memory stand-in for the repository, honest about IsNull/LessThan. */
  function fakeRepo() {
    const rows: AuthCode[] = [];
    const matches = (row: AuthCode, where: Record<string, unknown>) =>
      Object.entries(where).every(([k, v]) => {
        const actual = (row as unknown as Record<string, unknown>)[k];
        // IsNull() and friends arrive as FindOperator objects.
        if (v && typeof v === 'object' && '_type' in (v as object)) {
          const op = v as { _type: string; _value?: unknown };
          if (op._type === 'isNull') return actual === null || actual === undefined;
          if (op._type === 'lessThan') return (actual as Date) < (op._value as Date);
        }
        return actual === v;
      });
    return {
      rows,
      create: (v: Partial<AuthCode>) => ({ ...v, id: `id-${rows.length}` }) as AuthCode,
      save: async (v: AuthCode) => {
        const i = rows.findIndex((r) => r.id === v.id);
        if (i >= 0) rows[i] = v;
        else rows.push({ ...v, createdAt: new Date() } as AuthCode);
        return v;
      },
      update: async (where: Record<string, unknown>, patch: Partial<AuthCode>) => {
        for (const r of rows) if (matches(r, where)) Object.assign(r, patch);
      },
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        [...rows].reverse().find((r) => matches(r, where)) ?? null,
      delete: async () => undefined,
    };
  }

  const make = () => {
    const repo = fakeRepo();
    return { repo, svc: new AuthCodesService(repo as never) };
  };

  // Limits are static across instances; a fresh id per test keeps them apart.
  let n = 0;
  const user = () => `user-${++n}`;

  it('issues six digits and never stores them', async () => {
    const { svc, repo } = make();
    const u = user();
    const code = await svc.issue(u, 'password_reset', null);

    expect(code).toMatch(/^\d{6}$/);
    expect(repo.rows).toHaveLength(1);
    // The row must not contain the code in any readable form.
    expect(JSON.stringify(repo.rows[0])).not.toContain(code!);
    expect(repo.rows[0].codeHash).toHaveLength(64);
  });

  it('accepts the right code exactly once', async () => {
    const { svc } = make();
    const u = user();
    const code = (await svc.issue(u, 'password_reset', null))!;

    await expect(svc.consume(u, 'password_reset', code, null)).resolves.toBeUndefined();
    await expect(svc.consume(u, 'password_reset', code, null)).rejects.toThrow(/not valid/);
  });

  it('rejects a wrong code, and burns it after five tries', async () => {
    const { svc, repo } = make();
    const u = user();
    const code = (await svc.issue(u, 'password_reset', null))!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(svc.consume(u, 'password_reset', wrong, null)).rejects.toThrow(/not valid/);
    }
    // Burnt: even the correct code is now dead.
    expect(repo.rows[0].consumedAt).not.toBeNull();
    await expect(svc.consume(u, 'password_reset', code, null)).rejects.toThrow(/not valid/);
  });

  it('rejects an expired code', async () => {
    const { svc, repo } = make();
    const u = user();
    const code = (await svc.issue(u, 'password_reset', null))!;
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(svc.consume(u, 'password_reset', code, null)).rejects.toThrow(/not valid/);
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const { svc } = make();
    const u = user();
    const first = (await svc.issue(u, 'password_reset', null))!;
    const second = (await svc.issue(u, 'password_reset', null))!;

    await expect(svc.consume(u, 'password_reset', first, null)).rejects.toThrow(/not valid/);
    await expect(svc.consume(u, 'password_reset', second, null)).resolves.toBeUndefined();
  });

  it('keeps purposes separate, so one table can serve reset and login', async () => {
    const { svc } = make();
    const u = user();
    const reset = (await svc.issue(u, 'password_reset', null))!;

    // A reset code must not authenticate a login, and vice versa.
    await expect(svc.consume(u, 'login_otp', reset, null)).rejects.toThrow(/not valid/);
    await expect(svc.consume(u, 'password_reset', reset, null)).resolves.toBeUndefined();
  });

  it('rate-limits repeated requests for one account', async () => {
    const { svc } = make();
    const u = user();
    const issued = [
      await svc.issue(u, 'password_reset', null),
      await svc.issue(u, 'password_reset', null),
      await svc.issue(u, 'password_reset', null),
      await svc.issue(u, 'password_reset', null),
    ];
    // Fourth is declined — and the caller still has to answer identically.
    expect(issued.slice(0, 3).every((c) => typeof c === 'string')).toBe(true);
    expect(issued[3]).toBeNull();
  });

  it('gives the same message for every kind of failure', async () => {
    const { svc } = make();
    const u = user();
    const code = (await svc.issue(u, 'password_reset', null))!;

    const messages: string[] = [];
    const capture = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        messages.push((e as Error).message);
      }
    };
    await capture(() => svc.consume('nobody', 'password_reset', '123456', null));
    await capture(() => svc.consume(u, 'password_reset', '999999', null));
    await capture(() => svc.consume(u, 'login_otp', code, null));

    expect(new Set(messages).size).toBe(1);
  });
});
