/**
 * Outbound alert/digest delivery.
 *
 * One webhook URL serves several possible destinations, and they disagree on
 * both the JSON shape and the markup:
 *
 *   - Discord  → {"content": "..."}, **bold**, hard 2000-character limit
 *   - Slack    → {"text": "..."},    *bold*
 *   - ntfy     → raw body works, but {"content"} is accepted too
 *
 * Sending `{content, text}` satisfies all three, so the only real work is
 * Discord's length cap and its different bold syntax. Delivery is best-effort:
 * a failed webhook must never break the request path that triggered it.
 */

const DISCORD_LIMIT = 2000;
// Leave headroom for the code fence/ellipsis we may add when splitting.
const CHUNK_TARGET = 1900;

export function isDiscordWebhook(url: string): boolean {
  return /(^|\/\/)(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(url);
}

/** Slack-style *bold* → Discord-style **bold**. */
export function toDiscordMarkdown(text: string): string {
  // The trailing punctuation class must include ':' — the digest's own format is
  // "*Name*: 3h this week", which is the main thing this function has to convert.
  return text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!?]|$)/g, '$1**$2**');
}

/**
 * Split on line boundaries so a message never lands mid-word, and never exceeds
 * Discord's limit. A single over-long line is hard-split as a last resort.
 */
export function chunkForDiscord(text: string, limit = CHUNK_TARGET): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    const piece = line.length > limit ? line.slice(0, limit) : line;
    if (current.length + piece.length + 1 > limit) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

/**
 * Post a plain-text message to the configured webhook. Returns true when every
 * part was accepted. Never throws.
 */
export async function postWebhook(
  url: string,
  text: string,
  onError?: (message: string) => void,
): Promise<boolean> {
  if (!url) return false;

  const parts = isDiscordWebhook(url)
    ? chunkForDiscord(toDiscordMarkdown(text)).map((c) => ({ content: c }))
    : [{ content: text, text }];

  try {
    for (const body of parts) {
      let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Discord replies 429 with a Retry-After (seconds). One polite retry
      // turns a dropped message into a slightly late one.
      if (res.status === 429) {
        const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), 10);
        await new Promise((r) => setTimeout(r, (wait || 1) * 1000));
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        onError?.(`webhook responded ${res.status}`);
        return false;
      }
    }
    return true;
  } catch (e) {
    onError?.((e as Error).message);
    return false;
  }
}
