'use strict';

/**
 * Host-side input executor.
 *
 * Runs in the Electron *main* process and translates ControlMessage objects
 * (sent by the web client over the WebRTC data channel, then forwarded from
 * the renderer via IPC) into real OS input events using @nut-tree-fork/nut-js.
 *
 * nut-js is a native module, so it may fail to load (missing build toolchain,
 * OS without accessibility perms, etc.). We lazy-require it and fall back to
 * a no-op stub that just logs — Phase 4 still passes the smoke test even if
 * the optional native dep isn't present.
 */

let nut = null;
let available = false;
let screenSize = { width: 1920, height: 1080 };

// Sticky modifier state tracked so key { action: "down" } then { action: "up" }
// round-trips correctly.
const heldKeys = new Set();

async function init() {
  try {
    // eslint-disable-next-line global-require
    nut = require('@nut-tree-fork/nut-js');
    // Make synthetic input snappy.
    nut.mouse.config.mouseSpeed = 0;
    nut.keyboard.config.autoDelayMs = 0;
    const width = await nut.screen.width();
    const height = await nut.screen.height();
    screenSize = { width, height };
    available = true;
    // eslint-disable-next-line no-console
    console.log(`[input] nut-js ready, screen ${width}x${height}`);
  } catch (err) {
    available = false;
    // eslint-disable-next-line no-console
    console.warn('[input] nut-js unavailable, running in no-op mode:', err?.message || err);
  }
}

const BUTTON_MAP = () => ({
  left: nut.Button.LEFT,
  right: nut.Button.RIGHT,
  middle: nut.Button.MIDDLE,
});

// Map our portable key names to nut-js Key enum values.
function mapKey(name) {
  if (!nut) return null;
  const K = nut.Key;
  const n = String(name).toLowerCase();
  const table = {
    ctrl: K.LeftControl,
    control: K.LeftControl,
    alt: K.LeftAlt,
    shift: K.LeftShift,
    meta: K.LeftSuper,
    win: K.LeftSuper,
    cmd: K.LeftSuper,
    esc: K.Escape,
    escape: K.Escape,
    tab: K.Tab,
    enter: K.Enter,
    return: K.Enter,
    backspace: K.Backspace,
    delete: K.Delete,
    up: K.Up,
    down: K.Down,
    left: K.Left,
    right: K.Right,
    home: K.Home,
    end: K.End,
    pageup: K.PageUp,
    pagedown: K.PageDown,
    space: K.Space,
  };
  if (table[n]) return table[n];
  // F1..F12
  const fmatch = /^f([1-9]|1[0-2])$/.exec(n);
  if (fmatch) return K[`F${fmatch[1]}`];
  // Single letter / digit fallback: Key.A..Z, Key.Num0..Num9
  if (n.length === 1) {
    const up = n.toUpperCase();
    if (/[A-Z]/.test(up)) return K[up];
    if (/[0-9]/.test(up)) return K[`Num${up}`];
  }
  return null;
}

async function handle(msg) {
  if (!available || !nut) return;
  try {
    switch (msg.t) {
      case 'move-abs': {
        const x = Math.round(Math.min(1, Math.max(0, msg.x)) * screenSize.width);
        const y = Math.round(Math.min(1, Math.max(0, msg.y)) * screenSize.height);
        await nut.mouse.setPosition(new nut.Point(x, y));
        break;
      }
      case 'move-rel': {
        const pos = await nut.mouse.getPosition();
        const x = Math.max(0, Math.min(screenSize.width - 1, Math.round(pos.x + msg.dx)));
        const y = Math.max(0, Math.min(screenSize.height - 1, Math.round(pos.y + msg.dy)));
        await nut.mouse.setPosition(new nut.Point(x, y));
        break;
      }
      case 'click': {
        const btn = BUTTON_MAP()[msg.button] ?? nut.Button.LEFT;
        const count = Math.max(1, Math.min(3, msg.count || 1));
        for (let i = 0; i < count; i++) await nut.mouse.click(btn);
        break;
      }
      case 'button': {
        const btn = BUTTON_MAP()[msg.button] ?? nut.Button.LEFT;
        if (msg.action === 'down') await nut.mouse.pressButton(btn);
        else await nut.mouse.releaseButton(btn);
        break;
      }
      case 'scroll': {
        // nut-js scroll is in "ticks"; deltaY in pixels ~/ 40 per tick.
        const ticks = Math.round(msg.dy / 40);
        if (ticks !== 0) {
          if (ticks > 0) await nut.mouse.scrollDown(ticks);
          else await nut.mouse.scrollUp(-ticks);
        }
        break;
      }
      case 'key': {
        const k = mapKey(msg.key);
        if (!k) break;
        if (msg.action === 'down') {
          await nut.keyboard.pressKey(k);
          heldKeys.add(k);
        } else if (msg.action === 'up') {
          await nut.keyboard.releaseKey(k);
          heldKeys.delete(k);
        } else {
          // tap
          await nut.keyboard.pressKey(k);
          await nut.keyboard.releaseKey(k);
        }
        break;
      }
      case 'text': {
        if (typeof msg.text === 'string' && msg.text.length) {
          await nut.keyboard.type(msg.text);
        }
        break;
      }
      case 'quality':
        // Handled in the renderer via RTCRtpSender.setParameters, not here.
        break;
      default:
        break;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[input] error handling', msg?.t, err?.message || err);
  }
}

// Release any keys left pressed if the peer disconnects mid-gesture.
async function releaseAll() {
  if (!available || !nut) return;
  for (const k of heldKeys) {
    try { await nut.keyboard.releaseKey(k); } catch { /* ignore */ }
  }
  heldKeys.clear();
}

module.exports = { init, handle, releaseAll, get available() { return available; } };
