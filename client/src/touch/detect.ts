// Touch mode = the page cannot be played with a mouse and keyboard on this device (plan 19, M.1).
// iOS Safari (iPhone and iPad) has no Pointer Lock API; Android Chrome has it but no mouse. A laptop with a touchscreen
// keeps desktop mode because it has both. ?touch=1 forces touch mode, to try it with the browser's device emulation.

export interface TouchEnv {
  forced: boolean
  hasPointerLock: boolean
  /** A mouse-like pointer exists (any-pointer: fine). Browsers that do not know the media query count as "yes". */
  anyPointerFine: boolean
}

export function isTouchMode(env: TouchEnv): boolean {
  return env.forced || !env.hasPointerLock || !env.anyPointerFine
}

/** Landscape is required: the controls are laid out for a wide screen. A square screen counts as landscape. */
export function isPortrait(width: number, height: number): boolean {
  return height > width
}

export function readTouchEnv(): TouchEnv {
  if (typeof window === 'undefined') return { forced: false, hasPointerLock: true, anyPointerFine: true }
  const mq = window.matchMedia?.('(any-pointer: fine)')
  return {
    forced: new URLSearchParams(window.location.search).has('touch'),
    hasPointerLock: typeof Element !== 'undefined' && typeof Element.prototype.requestPointerLock === 'function',
    anyPointerFine: !mq || mq.media === 'not all' || mq.matches,
  }
}
