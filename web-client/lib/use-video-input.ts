'use client';

import { useCallback, useEffect, useRef } from 'react';
import { encode, type ControlMessage, type InputMode } from './control-protocol';

export interface Transform { scale: number; tx: number; ty: number }

interface Options {
  mode: InputMode;
  /** Multiplier applied to trackpad deltas before sending. */
  sensitivity?: number;
  /** Minimum pixels of movement before a tap becomes a drag. */
  tapSlopPx?: number;
  /** Max ms between down and up to still register as a tap. */
  tapMaxMs?: number;
  /** ms between the two taps of a double-tap. */
  doubleTapMaxMs?: number;
  /** Called whenever the CSS transform changes. */
  onTransformChange?: (t: Transform) => void;
  /** Called whenever the user interacts, so the parent can un-hide the toolbar. */
  onActivity?: () => void;
}

/**
 * Maps a pointer event on the video element to **normalized coordinates of the
 * host screen** (0..1), correctly accounting for:
 *   - CSS transform on the stage (pan + pinch zoom)
 *   - `object-fit: contain` letterboxing when the video aspect ratio doesn't
 *     match the element
 */
function pointerToHostNormalized(
  video: HTMLVideoElement,
  ev: { clientX: number; clientY: number },
): { x: number; y: number } | null {
  const rect = video.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const ex = (ev.clientX - rect.left) / rect.width;
  const ey = (ev.clientY - rect.top) / rect.height;

  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (!vw || !vh) return { x: clamp01(ex), y: clamp01(ey) };

  const elAspect = rect.width / rect.height;
  const vAspect = vw / vh;
  let scaleX = 1;
  let scaleY = 1;
  let offX = 0;
  let offY = 0;
  if (vAspect > elAspect) {
    const displayedH = rect.width / vAspect;
    scaleY = rect.height / displayedH;
    offY = (1 - 1 / scaleY) / 2;
  } else {
    const displayedW = rect.height * vAspect;
    scaleX = rect.width / displayedW;
    offX = (1 - 1 / scaleX) / 2;
  }

  const nx = (ex - offX) * scaleX;
  const ny = (ey - offY) * scaleY;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { x: nx, y: ny };
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** Clamp pan so the content never leaves the stage entirely. */
function clampPan(
  tx: number, ty: number, scale: number,
  stageW: number, stageH: number,
  edgeMargin = 48,
) {
  if (scale <= 1) return { tx: 0, ty: 0 };
  const contentW = stageW * scale;
  const contentH = stageH * scale;
  const minTx = -(contentW - stageW) - edgeMargin;
  const maxTx = edgeMargin;
  const minTy = -(contentH - stageH) - edgeMargin;
  const maxTy = edgeMargin;
  return {
    tx: Math.min(maxTx, Math.max(minTx, tx)),
    ty: Math.min(maxTy, Math.max(minTy, ty)),
  };
}

export function useVideoInput(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  send: ((msg: ControlMessage) => void) | null,
  opts: Options,
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const state = useRef({
    mode: opts.mode,
    sensitivity: opts.sensitivity ?? 1.8,
    tapSlopPx: opts.tapSlopPx ?? 8,
    tapMaxMs: opts.tapMaxMs ?? 250,
    doubleTapMaxMs: opts.doubleTapMaxMs ?? 320,
    pointers: new Map<number, { x: number; y: number; startX: number; startY: number; startT: number; moved: boolean }>(),
    lastTapT: 0,
    lastTapX: 0,
    lastTapY: 0,
    longPressTimer: 0 as number | 0,
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchCenter: { x: 0, y: 0 },
    pinchStartTx: 0,
    pinchStartTy: 0,
    panStart: null as { x: number; y: number; tx: number; ty: number } | null,
    scale: 1,
    tx: 0,
    ty: 0,
  });

  useEffect(() => {
    state.current.mode = opts.mode;
    state.current.sensitivity = opts.sensitivity ?? 1.8;
  }, [opts.mode, opts.sensitivity]);

  const emitTransform = useCallback(() => {
    optsRef.current.onTransformChange?.({
      scale: state.current.scale,
      tx: state.current.tx,
      ty: state.current.ty,
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !send) return;

    const s = state.current;

    function stageSize() {
      const p = video!.parentElement?.parentElement;
      return { w: p?.clientWidth ?? window.innerWidth, h: p?.clientHeight ?? window.innerHeight };
    }

    function clearLongPress() {
      if (s.longPressTimer) {
        clearTimeout(s.longPressTimer);
        s.longPressTimer = 0;
      }
    }

    function setScaleAround(nextScale: number, anchorX: number, anchorY: number) {
      const { w, h } = stageSize();
      const clamped = Math.max(1, Math.min(4, nextScale));
      const k = clamped / s.scale;
      s.tx = anchorX - k * (anchorX - s.tx);
      s.ty = anchorY - k * (anchorY - s.ty);
      s.scale = clamped;
      const clampedPan = clampPan(s.tx, s.ty, s.scale, w, h);
      s.tx = clampedPan.tx;
      s.ty = clampedPan.ty;
    }

    function notifyActivity() {
      optsRef.current.onActivity?.();
    }

    function onPointerDown(ev: PointerEvent) {
      notifyActivity();
      video!.setPointerCapture(ev.pointerId);
      s.pointers.set(ev.pointerId, {
        x: ev.clientX,
        y: ev.clientY,
        startX: ev.clientX,
        startY: ev.clientY,
        startT: performance.now(),
        moved: false,
      });

      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        s.pinchStartScale = s.scale;
        s.pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        s.pinchStartTx = s.tx;
        s.pinchStartTy = s.ty;
        s.panStart = { x: s.pinchCenter.x, y: s.pinchCenter.y, tx: s.tx, ty: s.ty };
        clearLongPress();
      } else if (s.pointers.size === 1) {
        s.longPressTimer = window.setTimeout(() => {
          if (s.pointers.size !== 1) return;
          const p = [...s.pointers.values()][0];
          if (p.moved) return;
          const coords = pointerToHostNormalized(video!, { clientX: p.x, clientY: p.y });
          if (coords) send!({ t: 'move-abs', ...coords });
          send!({ t: 'click', button: 'right' });
        }, 600);
      }
    }

    function onPointerMove(ev: PointerEvent) {
      const p = s.pointers.get(ev.pointerId);
      if (!p) return;
      const prevX = p.x;
      const prevY = p.y;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > s.tapSlopPx) {
        p.moved = true;
        clearLongPress();
      }

      if (s.pointers.size === 2 && s.panStart) {
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        if (s.pinchStartDist > 0) {
          const nextScale = Math.max(1, Math.min(4, s.pinchStartScale * (dist / s.pinchStartDist)));
          const k = nextScale / s.pinchStartScale;
          s.tx = midX - k * (s.pinchCenter.x - s.pinchStartTx);
          s.ty = midY - k * (s.pinchCenter.y - s.pinchStartTy);
          s.scale = nextScale;
        } else {
          s.tx = s.panStart.tx + (midX - s.panStart.x);
          s.ty = s.panStart.ty + (midY - s.panStart.y);
        }
        const { w, h } = stageSize();
        const clamped = clampPan(s.tx, s.ty, s.scale, w, h);
        s.tx = clamped.tx;
        s.ty = clamped.ty;
        emitTransform();
        return;
      }

      if (s.pointers.size === 1) {
        if (s.mode === 'trackpad') {
          // Invariant feel regardless of zoom.
          const k = s.sensitivity / s.scale;
          const dx = (p.x - prevX) * k;
          const dy = (p.y - prevY) * k;
          if (dx !== 0 || dy !== 0) send!({ t: 'move-rel', dx, dy });
        } else if (p.moved) {
          const coords = pointerToHostNormalized(video!, ev);
          if (coords) send!({ t: 'move-abs', ...coords });
        }
      }
    }

    function onPointerUp(ev: PointerEvent) {
      const p = s.pointers.get(ev.pointerId);
      clearLongPress();
      if (p) {
        const dt = performance.now() - p.startT;
        const isTap = !p.moved && dt < s.tapMaxMs;
        if (isTap) {
          // Double-tap → toggle zoom between 1x and 2x.
          const now = performance.now();
          const dist = Math.hypot(p.x - s.lastTapX, p.y - s.lastTapY);
          const isDoubleTap = now - s.lastTapT < s.doubleTapMaxMs && dist < 24;
          if (isDoubleTap) {
            setScaleAround(s.scale > 1 ? 1 : 2, p.x, p.y);
            emitTransform();
            s.lastTapT = 0;
          } else {
            s.lastTapT = now;
            s.lastTapX = p.x;
            s.lastTapY = p.y;
            // Both modes: place cursor at the tap then click.
            const coords = pointerToHostNormalized(video!, ev);
            if (coords) send!({ t: 'move-abs', ...coords });
            send!({ t: 'click', button: 'left' });
          }
        }
        s.pointers.delete(ev.pointerId);
      }
      if (s.pointers.size < 2) {
        s.panStart = null;
        s.pinchStartDist = 0;
      }
      try { video!.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    }

    function onPointerCancel(ev: PointerEvent) {
      clearLongPress();
      s.pointers.delete(ev.pointerId);
      if (s.pointers.size < 2) {
        s.panStart = null;
        s.pinchStartDist = 0;
      }
    }

    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      notifyActivity();
      if (ev.ctrlKey) {
        // Ctrl+wheel = zoom.
        const delta = -ev.deltaY * 0.01;
        setScaleAround(s.scale * Math.exp(delta), ev.clientX, ev.clientY);
        emitTransform();
        return;
      }
      let dx = ev.deltaX;
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) { dx *= 16; dy *= 16; }
      else if (ev.deltaMode === 2) { dx *= 100; dy *= 100; }
      send!({ t: 'scroll', dx, dy });
    }

    function onDoubleClick(ev: MouseEvent) {
      ev.preventDefault();
      const coords = pointerToHostNormalized(video!, ev);
      if (coords) send!({ t: 'move-abs', ...coords });
      send!({ t: 'click', button: 'left', count: 2 });
    }

    video.addEventListener('pointerdown', onPointerDown);
    video.addEventListener('pointermove', onPointerMove);
    video.addEventListener('pointerup', onPointerUp);
    video.addEventListener('pointercancel', onPointerCancel);
    video.addEventListener('wheel', onWheel, { passive: false });
    video.addEventListener('dblclick', onDoubleClick);

    return () => {
      clearLongPress();
      video.removeEventListener('pointerdown', onPointerDown);
      video.removeEventListener('pointermove', onPointerMove);
      video.removeEventListener('pointerup', onPointerUp);
      video.removeEventListener('pointercancel', onPointerCancel);
      video.removeEventListener('wheel', onWheel);
      video.removeEventListener('dblclick', onDoubleClick);
    };
  }, [videoRef, send, emitTransform]);
}

export function sendEncoded(channel: RTCDataChannel | null, msg: ControlMessage): boolean {
  if (!channel || channel.readyState !== 'open') return false;
  channel.send(encode(msg));
  return true;
}
