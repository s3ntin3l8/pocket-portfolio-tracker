import { useEffect } from "react";

export function useAsyncEffect(effect: () => Promise<void>, deps: unknown[]): void {
  useEffect(() => {
    let cancelled = false;
    void effect().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
