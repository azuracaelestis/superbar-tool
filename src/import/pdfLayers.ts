import * as pdfjsLib from 'pdfjs-dist';
// Vite-native worker wiring -- no manual copy into public/, the URL is resolved at build time.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfLayer {
  id: string;
  name: string;
  visible: boolean;
}

export interface LoadedPdf {
  doc: pdfjsLib.PDFDocumentProxy;
  layers: PdfLayer[];
}

/** Illustrator files are PDF-compatible, so this loads a .ai exactly like a .pdf and exposes its
 *  layers as Illustrator saved them (as PDF optional-content groups). */
export async function loadPdf(file: File): Promise<LoadedPdf> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const occ = await doc.getOptionalContentConfig();
  const layers: PdfLayer[] = [];
  if (occ) {
    for (const id of occ.getOrder() ?? []) {
      if (typeof id !== 'string') continue; // nested arrays are sub-group headers -- flat list is enough here
      const group = occ.getGroup(id);
      layers.push({ id, name: group?.name ?? id, visible: occ.isVisible(id) });
    }
  }
  return { doc, layers };
}

/** Renders page 1 with only the given layer ids visible, onto a fresh transparent canvas at
 *  `scale` (default 4x the PDF's native 72dpi points, so it stays sharp through a 4K export). */
export async function rasterizePdf(
  loaded: LoadedPdf,
  visibleLayerIds: Set<string>,
  scale = 4,
): Promise<HTMLCanvasElement> {
  const page = await loaded.doc.getPage(1);
  const occ = await loaded.doc.getOptionalContentConfig();
  if (occ) {
    for (const layer of loaded.layers) {
      occ.setVisibility(layer.id, visibleLayerIds.has(layer.id));
    }
  }

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;

  await page.render({ canvas, canvasContext: ctx, viewport, optionalContentConfigPromise: Promise.resolve(occ) } as any).promise;
  return canvas;
}

export function cropCanvas(source: HTMLCanvasElement, crop: { top: number; bottom: number; left: number; right: number }): HTMLCanvasElement {
  const w = Math.max(1, Math.round(crop.right - crop.left));
  const h = Math.max(1, Math.round(crop.bottom - crop.top));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(source, crop.left, crop.top, w, h, 0, 0, w, h);
  return out;
}

export async function rasterizeSvg(file: File, targetWidth = 2400): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('failed to load SVG'));
      img.src = url;
    });
    const aspect = img.naturalHeight / img.naturalWidth || 1;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = Math.round(targetWidth * aspect);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
