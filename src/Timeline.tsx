import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BarInstance } from '../shared/animate.js';

interface Props {
  durationSec: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  bar: BarInstance;
  onScrub: (t: number) => void;
  onChangeBar: (patch: Partial<BarInstance>) => void;
}

type DragMode = 'none' | 'move' | 'hold-edge' | 'scrub';

/** Clamps a proposed `inSec` so the bar's full visible window never runs past 0 or the video's
 *  duration -- pulled out as a pure function so the drag math is testable without simulating
 *  pointer events. */
export function computeDraggedInSec(bar: BarInstance, proposedInSec: number, durationSec: number): number {
  const windowLength = bar.inDurationSec + bar.holdSec + bar.outDurationSec;
  const maxInSec = Math.max(0, durationSec - windowLength);
  return Math.min(Math.max(0, proposedInSec), maxInSec);
}

/** Clamps a proposed `holdSec` so the held/exiting boundary stays between the end of the
 *  entrance ramp and the point where the exit ramp would run past the video's duration. */
export function computeDraggedHoldSec(bar: BarInstance, proposedHoldEndSec: number, durationSec: number): number {
  const minHoldEnd = bar.inSec + bar.inDurationSec;
  const maxHoldEnd = Math.max(minHoldEnd, durationSec - bar.outDurationSec);
  const clampedHoldEnd = Math.min(Math.max(minHoldEnd, proposedHoldEndSec), maxHoldEnd);
  return clampedHoldEnd - minHoldEnd;
}

export default function Timeline({ durationSec, videoRef, bar, onScrub, onChangeBar }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragTooltip, setDragTooltip] = useState<string | null>(null);

  const dragState = useRef<{
    mode: DragMode;
    trackRect: DOMRect;
    startClientX: number;
    startInSec: number;
    startHoldEndSec: number;
  } | null>(null);

  // Playhead follows video.currentTime at animation-frame rate via direct DOM mutation --
  // going through React state here would re-render the whole sidebar 60x/sec.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const track = trackRef.current;
      const playhead = playheadRef.current;
      if (video && track && playhead && durationSec > 0) {
        const frac = Math.min(1, Math.max(0, video.currentTime / durationSec));
        playhead.style.left = `${frac * 100}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, durationSec]);

  function secFromClientX(clientX: number, trackRect: DOMRect): number {
    const frac = (clientX - trackRect.left) / trackRect.width;
    return Math.min(Math.max(0, frac), 1) * durationSec;
  }

  function beginDrag(mode: DragMode, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Capture the pointer so drag continues even if the cursor leaves the handle's bounds --
    // without this, a fast or imprecise drag falls back to the browser's native text-selection
    // behavior instead of tracking the gesture. Best-effort: setPointerCapture can throw (e.g.
    // the pointer isn't currently active for this target), and since the window-level
    // pointermove/pointerup listeners below don't depend on capture to function, a failed
    // capture should degrade gracefully rather than abort the drag before it starts.
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // fall through -- window listeners still track the drag without capture
    }
    const trackRect = trackRef.current!.getBoundingClientRect();
    const holdEndSec = bar.inSec + bar.inDurationSec + bar.holdSec;
    dragState.current = { mode, trackRect, startClientX: e.clientX, startInSec: bar.inSec, startHoldEndSec: holdEndSec };
    setDragMode(mode);
  }

  useEffect(() => {
    if (dragMode === 'none') return;

    function handleMove(e: PointerEvent) {
      const drag = dragState.current;
      if (!drag) return;
      const deltaSec = secFromClientX(e.clientX, drag.trackRect) - secFromClientX(drag.startClientX, drag.trackRect);

      if (drag.mode === 'move') {
        const newInSec = computeDraggedInSec(bar, drag.startInSec + deltaSec, durationSec);
        onChangeBar({ inSec: newInSec });
        setDragTooltip(`In: ${newInSec.toFixed(2)}s`);
      } else if (drag.mode === 'hold-edge') {
        const newHoldSec = computeDraggedHoldSec(bar, drag.startHoldEndSec + deltaSec, durationSec);
        onChangeBar({ holdSec: newHoldSec });
        setDragTooltip(`Hold ends: ${(bar.inSec + bar.inDurationSec + newHoldSec).toFixed(2)}s`);
      } else if (drag.mode === 'scrub') {
        onScrub(secFromClientX(e.clientX, drag.trackRect));
      }
    }

    function handleUp() {
      dragState.current = null;
      setDragMode('none');
      setDragTooltip(null);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dragState ref carries the live values
  }, [dragMode, bar, durationSec, onChangeBar, onScrub]);

  function handleTrackPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // fall through -- window listeners still track the drag without capture
    }
    const trackRect = trackRef.current!.getBoundingClientRect();
    dragState.current = { mode: 'scrub', trackRect, startClientX: e.clientX, startInSec: bar.inSec, startHoldEndSec: 0 };
    setDragMode('scrub');
    onScrub(secFromClientX(e.clientX, trackRect));
  }

  if (durationSec <= 0) return null;

  const windowStart = bar.inSec;
  const windowEnd = Math.min(durationSec, bar.inSec + bar.inDurationSec + bar.holdSec + bar.outDurationSec);
  const windowLength = Math.max(0, windowEnd - windowStart);
  const pct = (sec: number) => `${(sec / durationSec) * 100}%`;

  const totalRamp = bar.inDurationSec + bar.holdSec + bar.outDurationSec || 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={trackRef}
        className="relative h-16 bg-zinc-800 rounded-lg cursor-pointer select-none"
        onPointerDown={handleTrackPointerDown}
      >
        {/* the bar's visible window */}
        <div
          className="absolute top-1 bottom-1 rounded-md overflow-hidden flex cursor-grab active:cursor-grabbing"
          style={{ left: pct(windowStart), width: `${(windowLength / durationSec) * 100}%` }}
          onPointerDown={(e) => beginDrag('move', e)}
        >
          <div
            className="h-full bg-gradient-to-r from-indigo-500/20 to-indigo-500"
            style={{ flexGrow: bar.inDurationSec / totalRamp || 0.0001 }}
          />
          <div className="h-full bg-indigo-500" style={{ flexGrow: bar.holdSec / totalRamp || 0.0001 }} />
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-500/20"
            style={{ flexGrow: bar.outDurationSec / totalRamp || 0.0001 }}
          />
        </div>

        {/* hold/exit boundary handle -- the one drag that changes holdSec */}
        <div
          className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize z-10"
          style={{ left: pct(bar.inSec + bar.inDurationSec + bar.holdSec) }}
          onPointerDown={(e) => beginDrag('hold-edge', e)}
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/70 -translate-x-1/2" />
        </div>

        {/* playhead */}
        <div ref={playheadRef} className="absolute top-0 bottom-0 w-px bg-white pointer-events-none" style={{ left: 0 }}>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-white rounded-full" />
        </div>
      </div>

      <div className="flex justify-between text-xs text-zinc-500">
        <span>0:00</span>
        {dragTooltip ? (
          <span className="text-indigo-400 font-medium">{dragTooltip}</span>
        ) : (
          <span>
            In {bar.inSec.toFixed(1)}s · Hold {bar.holdSec.toFixed(1)}s
          </span>
        )}
        <span>{durationSec.toFixed(1)}s</span>
      </div>
    </div>
  );
}
