'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function Composer({
  onSend, onTyping, disabled,
}: {
  onSend: (text: string) => void;
  onTyping?: (typing: boolean) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autosize = useCallback(() => {
    const ta = taRef.current; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);
  useEffect(autosize, [text, autosize]);

  const submit = () => {
    const v = text.trim(); if (!v || disabled) return;
    onSend(v); setText(''); onTyping?.(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => onTyping(false), 1500);
    }
  };

  return (
    <div className="composer">
      <button className="icon-btn" aria-label="Emoji">😊</button>
      <button className="icon-btn" aria-label="Attach">📎</button>
      <textarea
        ref={taRef}
        rows={1}
        placeholder="Type a message"
        value={text}
        onChange={onChange}
        onKeyDown={onKey}
        disabled={disabled}
      />
      <button className="send" onClick={submit} aria-label="Send" disabled={disabled || !text.trim()}>
        ➤
      </button>
    </div>
  );
}
