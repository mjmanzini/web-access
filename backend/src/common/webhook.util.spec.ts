import { chunkForDiscord, isDiscordWebhook, toDiscordMarkdown } from './webhook.util';

describe('webhook delivery', () => {
  it('recognises Discord webhook URLs', () => {
    expect(isDiscordWebhook('https://discord.com/api/webhooks/123/abc')).toBe(true);
    expect(isDiscordWebhook('https://discordapp.com/api/webhooks/123/abc')).toBe(true);
    expect(isDiscordWebhook('https://ptb.discord.com/api/webhooks/123/abc')).toBe(true);
    expect(isDiscordWebhook('https://ntfy.sh/my-topic')).toBe(false);
    expect(isDiscordWebhook('https://hooks.slack.com/services/x/y/z')).toBe(false);
  });

  it('converts Slack bold to Discord bold', () => {
    expect(toDiscordMarkdown('• *Njabulo*: 3h this week')).toBe('• **Njabulo**: 3h this week');
    // Leaves non-bold asterisks (e.g. a wildcard rule) alone.
    expect(toDiscordMarkdown('blocked *.doubleclick.net')).toBe('blocked *.doubleclick.net');
  });

  it('never emits a chunk over Discord’s limit', () => {
    const line = 'x'.repeat(120);
    const text = Array.from({ length: 40 }, () => line).join('\n'); // ~4.8k chars
    const chunks = chunkForDiscord(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1900);
    // Nothing is dropped: every source line still appears somewhere.
    expect(chunks.join('\n').split('\n').length).toBe(40);
  });

  it('splits on line boundaries rather than mid-line', () => {
    const text = ['alpha', 'beta', 'gamma'].map((w) => w.repeat(200)).join('\n');
    for (const c of chunkForDiscord(text, 700)) {
      for (const line of c.split('\n')) {
        expect(/^(alpha|beta|gamma)+$/.test(line)).toBe(true);
      }
    }
  });

  it('hard-splits a single over-long line instead of exceeding the cap', () => {
    const [chunk] = chunkForDiscord('y'.repeat(5000), 1900);
    expect(chunk.length).toBe(1900);
  });
});
