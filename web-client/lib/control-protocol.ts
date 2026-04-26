// Shared control-channel protocol between the Web Client and the Electron Host.
// Keep this file copy-compatible between both sides (no runtime deps).

export type MouseButton = 'left' | 'right' | 'middle';

export type InputMode = 'trackpad' | 'touch';

export type ControlMessage =
  // Absolute pointer in normalized coordinates (0..1 of the host's screen).
  | { t: 'move-abs'; x: number; y: number }
  // Relative trackpad delta (host multiplies by its own screen size + sensitivity).
  | { t: 'move-rel'; dx: number; dy: number }
  | { t: 'button'; button: MouseButton; action: 'down' | 'up' }
  | { t: 'click'; button: MouseButton; count?: number }
  // Vertical + horizontal scroll in "lines".
  | { t: 'scroll'; dx: number; dy: number }
  // Keyboard: `key` uses the same names as the virtual-key bar
  // (ctrl, alt, meta, shift, tab, esc, enter, backspace, f1..f12, arrow-up, ...).
  | { t: 'key'; key: string; action: 'down' | 'up' | 'tap' }
  // Typed text from the soft keyboard.
  | { t: 'text'; text: string }
  // Client requests a lower-bitrate track (Phase 4).
  | { t: 'quality'; level: 'low' | 'medium' | 'high' };

export function encode(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

export function decode(raw: string | ArrayBuffer): ControlMessage | null {
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    return JSON.parse(text) as ControlMessage;
  } catch {
    return null;
  }
}
