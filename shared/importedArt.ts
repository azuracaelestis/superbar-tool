import type { SliceHandles } from './ninegrid.js';

/** Wire format for an imported background: sent browser -> server as-is, since the browser
 *  already has the rasterized PNG and the operator's chosen slice/inset values. */
export interface ImportedArtPayload {
  dataUrl: string; // data:image/png;base64,...
  width: number;
  height: number;
  slices: SliceHandles;
  textInsetLeft: number;
  textInsetRight: number;
  textBaselineFromTop: number;
}
