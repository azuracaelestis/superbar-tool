import type { ImportedArtPayload } from '../shared/importedArt.js';

export interface DesignSystemPreset {
  id: 'corporate' | 'education' | 'business' | 'proav';
  label: string;
  enabled: boolean;
  /** Absent = falls through to the procedural bar (shared/spec.ts + drawSuperBar). Present once
   *  a division's AE file has been mined into a baked 9-slice asset. */
  art?: ImportedArtPayload;
}

/** The controlled set of brand Design Systems this tool offers. Corporate is real, drawn from
 *  the procedural bar calibrated against EP4-6.aep. The other three are placeholders -- real
 *  source files exist (each division has its own .aep in the ViewSonic Dropbox), but mining one
 *  to the same fidelity is the same multi-hour effort spent once already, per division. They
 *  ship disabled until that's done; turning one on later is just filling in `art` and flipping
 *  `enabled`, not touching this registry's shape or the UI that reads it. */
export const PRESETS: DesignSystemPreset[] = [
  { id: 'corporate', label: 'ViewSonic Corporate', enabled: true },
  { id: 'education', label: 'ViewSonic Education', enabled: false },
  { id: 'business', label: 'ViewSonic Business', enabled: false },
  { id: 'proav', label: 'ViewSonic ProAV', enabled: false },
];
