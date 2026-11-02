import type { LiveRig } from "../live/live";

/** Entrada del Akai MPD218: pads (nota+velocidad, aftertouch) y knobs (CC). Acepta cualquier canal. */
export function handleMpd218(rig: LiveRig, data: Uint8Array): void {
  if (data.length < 2) return;
  const type = data[0] & 0xf0;
  const a = data[1], b = data[2] ?? 0;
  switch (type) {
    case 0x90: rig.midiNote(a, b); break;
    case 0x80: rig.midiNote(a, 0); break;
    case 0xa0: rig.midiPressure(a, b); break;
    case 0xb0: rig.midiCC(a, b); break;
  }
}
