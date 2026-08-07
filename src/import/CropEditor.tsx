import { useEffect, useRef, useState } from 'react';
import type { CropRect } from '../../shared/ninegrid.js';

interface Props {
  canvas: HTMLCanvasElement;
  crop: CropRect;
  onChange: (crop: CropRect) => void;
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

/** Marks the bar's own bounding box within a larger rasterized page -- the step that was
 *  missing before: without it, an imported page (bar + surrounding whitespace/decoration)
 *  scales by its own full height instead of the bar's, so the bar renders as a sliver. */
export default function CropEditor({ canvas, crop, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Edge | null>(null);
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    host.replaceChildren(canvas);
    canvas.style.width = '100%';
    canvas.style.display = 'block';
    setDisplayScale((containerRef.current?.clientWidth ?? canvas.width) / canvas.width);
  }, [canvas]);

  function toSource(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) / displayScale)),
      y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) / displayScale)),
    };
  }

  function handleMove(e: React.MouseEvent) {
    if (!dragging) return;
    const { x, y } = toSource(e.clientX, e.clientY);
    switch (dragging) {
      case 'top': onChange({ ...crop, top: Math.min(y, crop.bottom - 10) }); break;
      case 'bottom': onChange({ ...crop, bottom: Math.max(y, crop.top + 10) }); break;
      case 'left': onChange({ ...crop, left: Math.min(x, crop.right - 10) }); break;
      case 'right': onChange({ ...crop, right: Math.max(x, crop.left + 10) }); break;
    }
  }

  const s = displayScale;
  const box = { left: crop.left * s, top: crop.top * s, width: (crop.right - crop.left) * s, height: (crop.bottom - crop.top) * s };

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onMouseMove={handleMove}
      onMouseUp={() => setDragging(null)}
      onMouseLeave={() => setDragging(null)}
    >
      <div ref={canvasHostRef} />

      {/* dim everything outside the crop box */}
      <div className="absolute inset-0 bg-black/50 pointer-events-none" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.left}px ${box.top}px, ${box.left}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top}px, ${box.left}px ${box.top}px)` }} />

      <div
        className="absolute border-2 border-indigo-400 pointer-events-none"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      />

      <div className="absolute h-2 cursor-ns-resize" style={{ left: box.left, top: box.top - 4, width: box.width }} onMouseDown={() => setDragging('top')} />
      <div className="absolute h-2 cursor-ns-resize" style={{ left: box.left, top: box.top + box.height - 4, width: box.width }} onMouseDown={() => setDragging('bottom')} />
      <div className="absolute w-2 cursor-ew-resize" style={{ top: box.top, left: box.left - 4, height: box.height }} onMouseDown={() => setDragging('left')} />
      <div className="absolute w-2 cursor-ew-resize" style={{ top: box.top, left: box.left + box.width - 4, height: box.height }} onMouseDown={() => setDragging('right')} />
    </div>
  );
}
