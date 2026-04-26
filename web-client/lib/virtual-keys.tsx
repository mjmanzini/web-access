'use client';

import type { ControlMessage } from './control-protocol';

interface Props {
  send: (msg: ControlMessage) => void;
  sticky: Record<string, boolean>;
  onToggleSticky: (key: string) => void;
}

/** Keys held until tapped again (Ctrl/Alt/Shift/Meta). */
const STICKY_KEYS = ['ctrl', 'alt', 'shift', 'meta'] as const;
/** One-shot keys sent as `tap`. */
const TAP_KEYS = ['esc', 'tab', 'enter', 'backspace', 'delete', 'up', 'down', 'left', 'right'] as const;

export function VirtualKeys({ send, sticky, onToggleSticky }: Props) {
  return (
    <div className="vkeys">
      {STICKY_KEYS.map((k) => (
        <button
          key={k}
          className={`vkey ${sticky[k] ? 'active' : ''}`}
          onClick={() => {
            const nowDown = !sticky[k];
            onToggleSticky(k);
            send({ t: 'key', key: k, action: nowDown ? 'down' : 'up' });
          }}
        >
          {label(k)}
        </button>
      ))}
      {TAP_KEYS.map((k) => (
        <button
          key={k}
          className="vkey"
          onClick={() => send({ t: 'key', key: k, action: 'tap' })}
        >
          {label(k)}
        </button>
      ))}
    </div>
  );
}

function label(k: string): string {
  switch (k) {
    case 'ctrl': return 'Ctrl';
    case 'alt': return 'Alt';
    case 'shift': return 'Shift';
    case 'meta': return 'Win';
    case 'esc': return 'Esc';
    case 'tab': return 'Tab';
    case 'enter': return '⏎';
    case 'backspace': return '⌫';
    case 'delete': return 'Del';
    case 'up': return '↑';
    case 'down': return '↓';
    case 'left': return '←';
    case 'right': return '→';
    default: return k;
  }
}
