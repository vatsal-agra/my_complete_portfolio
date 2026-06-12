/**
 * Tiny device-capability helpers. `pointer: coarse` is the standards-track way
 * to ask "is this primarily a touch device?" — true for phones and tablets,
 * false for desktops (even touchscreen ones expose `pointer: fine` for the
 * primary pointer). Used to swap OrbitControls touch mappings so phones get
 * one-finger ROTATE instead of one-finger PAN.
 */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}
