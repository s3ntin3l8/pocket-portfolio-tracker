/**
 * Shared `<ViewTransition>` name pairing a holdings-row logo with the instrument header
 * logo. Lives outside `instrument-logo.tsx` (a client module) so server components can call it.
 */
export function instrumentLogoTransitionName(instrumentId: string) {
  return `instrument-logo-${instrumentId}`;
}
