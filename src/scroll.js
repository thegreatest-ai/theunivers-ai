// Global scroll state, written by Lenis (outside React), read inside useFrame.
// Never store this in React state — mutating a shared ref per frame keeps the
// render loop off the React reconciler (the pro pattern).
export const scroll = { offset: 0, vel: 0 }
