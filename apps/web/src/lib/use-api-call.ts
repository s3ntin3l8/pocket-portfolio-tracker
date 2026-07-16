import { useCallback, useState } from "react";

export function useApiCall<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
): [
  { busy: boolean; error: string | null },
  (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | undefined>,
] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>> | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return (await fn(...args)) as Awaited<ReturnType<T>>;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return [{ busy, error }, call];
}
