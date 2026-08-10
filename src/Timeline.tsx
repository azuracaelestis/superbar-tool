import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BarInstance } from '../shared/animate.js';

interface Props {
  durationSec: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  bars: BarInstance[];
  selectedBarId: string;
  onSelectBar: (id: string) => void;
  onChangeBar: (id: string, patch: Partial<BarInstance>) => void;
  onScrub: (t: number) => void;
}

type DragMode = 'none' | 'move' | 'hold-edge' | 'scrub';

/** Clamps a proposed `inSec` so the bar's full visible window never runs past 0, the video's
 *  duration, or a neighboring bar's window (in a single-lane, non-overlapping timeline) --
 *  pulled out as a pure function so the drag math is testable without simulating pointer events.
 *  `prevBarEndSec`/`nextBarStartSec` default to the old single-bar bounds (0 / durationSec) so
 *  this stays backwards compatible when there's no neighbor on one side. Closed/closed touch is
 *  allowed (a bar may end exactly where the next one starts, zero gap) -- matches sampleBar's own
 *  closed/closed window check in shared/animate.ts. */
export function computeDraggedInSec(
  bar: BarInstance,
  proposedInSec: number,
  durationSec: number,
  prevBarEndSec = 0,
  nextBarStartSec = durationSec,
): number {
  const windowLength = bar.inDurationSec + bar.holdSec + bar.outDurationSec;
  const lowerBound = Math.max(0, prevBarEndSec);
  const upperBound = Math.max(lowerBound, Math.min(durationSec, nextBarStartSec) - windowLength);
  return Math.min(Math.max(lowerBound, proposedInSec), upperBound);
}

/** Clamps a proposed `holdSec` so the held/exiting boundary stays between the end of the
 *  entrance ramp and the point where the exit ramp would run past the video's duration OR the
 *  next bar's own start (see computeDraggedInSec for the neighbor-bound convention). */
export function computeDraggedHoldSec(
  bar: BarInstance,
  proposedHoldEndSec: number,
  durationSec: number,
  nextBarStartSec = durationSec,
): number {
  const minHoldEnd = bar.inSec + bar.inDurationSec;
  const maxHoldEnd = Math.max(minHoldEnd, Math.min(durationSec, nextBarStartSec) - bar.outDurationSec);
  const clampedHoldEnd = Math.min(Math.max(minHoldEnd, proposedHoldEndSec), maxHoldEnd);
  return clampedHoldEnd - minHoldEnd;
}

export default function Timeline({ durationSec, videoRef, bars, selectedBarId, onSelectBar, onChangeBar, onScrub }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragTooltip, setDragTooltip] = useState<string | null>(null);

  // Bars are laid out (and clamped against each other) in inSec order -- this is the single lane
  // the timeline enforces, not a rendering-only sort.
  const sortedBars = [...bars].sort((a, b) => a.inSec - b.inSec);

  const dragState = useRef<{
    mode: DragMode;
    barId: string | null; // null only for 'scrub', which doesn't touch any bar
    trackRect: DOMRect;
    startClientX: number;
    startInSec: number;
    startHoldEndSec: number;
    prevBarEndSec: number;
    nextBarStartSec: number;
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

  // Bounds a bar's own window is clamped against, from its neighbors in the sorted lane -- 0/
  // durationSec at the ends, since there's nothing to clamp against there.
  function neighborBounds(barId: string): { prevBarEndSec: number; nextBarStartSec: number } {
    const idx = sortedBars.findIndex((b) => b.id === barId);
    const prev = idx > 0 ? sortedBars[idx - 1] : null;
    const next = idx >= 0 && idx < sortedBars.length - 1 ? sortedBars[idx + 1] : null;
    return {
      prevBarEndSec: prev ? prev.inSec + prev.inDurationSec + prev.holdSec + prev.outDurationSec : 0,
      nextBarStartSec: next ? next.inSec : durationSec,
    };
  }

  function beginDrag(mode: 'move' | 'hold-edge', targetBar: BarInstance, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    onSelectBar(targetBar.id);
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
    const holdEndSec = targetBar.inSec + targetBar.inDurationSec + targetBar.holdSec;
    const { prevBarEndSec, nextBarStartSec } = neighborBounds(targetBar.id);
    dragState.current = {
      mode,
      barId: targetBar.id,
      trackRect,
      startClientX: e.clientX,
      startInSec: targetBar.inSec,
      startHoldEndSec: holdEndSec,
      prevBarEndSec,
      nextBarStartSec,
    };
    setDragMode(mode);
  }

  useEffect(() => {
    if (dragMode === 'none') return;

    function handleMove(e: PointerEvent) {
      const drag = dragState.current;
      if (!drag) return;
      const deltaSec = secFromClientX(e.clientX, drag.trackRect) - secFromClientX(drag.startClientX, drag.trackRect);

      if (drag.mode === 'move' && drag.barId) {
        const targetBar = bars.find((b) => b.id === drag.barId);
        if (!targetBar) return;
        const newInSec = computeDraggedInSec(
          targetBar, drag.startInSec + deltaSec, durationSec, drag.prevBarEndSec, drag.nextBarStartSec,
        );
        onChangeBar(drag.barId, { inSec: newInSec });
        setDragTooltip(`In: ${newInSec.toFixed(2)}s`);
      } else if (drag.mode === 'hold-edge' && drag.barId) {
        const targetBar = bars.find((b) => b.id === drag.barId);
        if (!targetBar) return;
        const newHoldSec = computeDraggedHoldSec(
          targetBar, drag.startHoldEndSec + deltaSec, durationSec, drag.nextBarStartSec,
        );
        onChangeBar(drag.barId, { holdSec: newHoldSec });
        setDragTooltip(`Hold ends: ${(targetBar.inSec + targetBar.inDurationSec + newHoldSec).toFixed(2)}s`);
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
  }, [dragMode, bars, durationSec, onChangeBar, onScrub]);

  function handleTrackPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // fall through -- window listeners still track the drag without capture
    }
    const trackRect = trackRef.current!.getBoundingClientRect();
    dragState.current = {
      mode: 'scrub',
      barId: null,
      trackRect,
      startClientX: e.clientX,
      startInSec: 0,
      startHoldEndSec: 0,
      prevBarEndSec: 0,
      nextBarStartSec: durationSec,
    };
    setDragMode('scrub');
    onScrub(secFromClientX(e.clientX, trackRect));
  }

  if (durationSec <= 0) return null;

  const pct = (sec: number) => `${(sec / durationSec) * 100}%`;
  const selectedBar = bars.find((b) => b.id === selectedBarId) ?? null;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={trackRef}
        className="relative h-16 bg-zinc-800 rounded-lg cursor-pointer select-none"
        onPointerDown={handleTrackPointerDown}
      >
        {sortedBars.map((b) => {
          const windowStart = b.inSec;
          const windowEnd = Math.min(durationSec, b.inSec + b.inDurationSec + b.holdSec + b.outDurationSec);
          const windowLength = Math.max(0, windowEnd - windowStart);
          const totalRamp = b.inDurationSec + b.holdSec + b.outDurationSec || 1;
          const isSelected = b.id === selectedBarId;

          return (
            <div key={b.id}>
              {/* the bar's visible window */}
              <div
                className={`absolute top-1 bottom-1 rounded-md overflow-hidden flex cursor-grab active:cursor-grabbing ${
                  isSelected ? 'ring-2 ring-white' : ''
                }`}
                style={{ left: pct(windowStart), width: `${(windowLength / durationSec) * 100}%` }}
                onPointerDown={(e) => beginDrag('move', b, e)}
              >
                <div
                  className="h-full bg-gradient-to-r from-indigo-500/20 to-indigo-500"
                  style={{ flexGrow: b.inDurationSec / totalRamp || 0.0001 }}
                />
                <div className="h-full bg-indigo-500" style={{ flexGrow: b.holdSec / totalRamp || 0.0001 }} />
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-indigo-500/20"
                  style={{ flexGrow: b.outDurationSec / totalRamp || 0.0001 }}
                />
              </div>

              {/* hold/exit boundary handle -- the one drag that changes holdSec */}
              <div
                className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize z-10"
                style={{ left: pct(b.inSec + b.inDurationSec + b.holdSec) }}
                onPointerDown={(e) => beginDrag('hold-edge', b, e)}
              >
                <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/70 -translate-x-1/2" />
              </div>
            </div>
          );
        })}

        {/* playhead */}
        <div ref={playheadRef} className="absolute top-0 bottom-0 w-px bg-white pointer-events-none" style={{ left: 0 }}>
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-white rounded-full" />
        </div>
      </div>

      <div className="flex justify-between text-xs text-zinc-500">
        <span>0:00</span>
        {dragTooltip ? (
          <span className="text-indigo-400 font-medium">{dragTooltip}</span>
        ) : selectedBar ? (
          <span>
            In {selectedBar.inSec.toFixed(1)}s · Hold {selectedBar.holdSec.toFixed(1)}s
          </span>
        ) : (
          <span />
        )}
        <span>{durationSec.toFixed(1)}s</span>
      </div>
    </div>
  );
}
