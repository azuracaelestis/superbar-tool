import { useEffect, useRef, useState } from 'react';
import type { SliceHandles } from '../../shared/ninegrid.js';

interface Props {
  canvas: HTMLCanvasElement;
  slices: SliceHandles;
  onChange: (slices: SliceHandles) => void;
}

/** Shows the rasterized artwork with two draggable vertical guides marking the fixed-left /
 *  stretchable-middle / fixed-right boundary -- the same 9-slice model drawImportedBar() draws.
 *  The canvas is mounted into its own imperatively-owned host div, kept separate from the
 *  React-rendered guide overlays -- mixing the two in one container had React's virtual DOM
 *  and a manual innerHTML='' fight over the same children, which silently deleted the guides. */
export default function SliceEditor({ canvas, slices, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    host.replaceChildren(canvas);
    canvas.style.width = '100%';
    canvas.style.display = 'block';
    setDisplayWidth(containerRef.current?.clientWidth ?? 0);
  }, [canvas]);

  const scale = displayWidth / canvas.width || 1;

  function handleMove(e: React.MouseEvent) {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sourceX = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) / scale));
    if (dragging === 'left') {
      onChange({ leftX: Math.min(sourceX, slices.rightX - 5), rightX: slices.rightX });
    } else {
      onChange({ leftX: slices.leftX, rightX: Math.max(sourceX, slices.leftX + 5) });
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      onMouseMove={handleMove}
      onMouseUp={() => setDragging(null)}
      onMouseLeave={() => setDragging(null)}
    >
      <div ref={canvasHostRef} />
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 cursor-ew-resize"
        style={{ left: slices.leftX * scale }}
        onMouseDown={() => setDragging('left')}
      >
        <div className="absolute -top-5 -left-2 w-4 h-4 bg-indigo-400 rounded-full" />
      </div>
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 cursor-ew-resize"
        style={{ left: slices.rightX * scale }}
        onMouseDown={() => setDragging('right')}
      >
        <div className="absolute -top-5 -left-2 w-4 h-4 bg-indigo-400 rounded-full" />
      </div>
      <div
        className="absolute top-0 bottom-0 bg-indigo-400/10 pointer-events-none"
        style={{ left: slices.leftX * scale, width: (slices.rightX - slices.leftX) * scale }}
      />
    </div>
  );
}
