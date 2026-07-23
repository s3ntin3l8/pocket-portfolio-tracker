/** The `@modal` slot's fallback — renders nothing when no intercepted route is active
 *  (i.e. every route except an in-app navigation to `/settings/*` or `/admin/*`).
 *  Required by Next.js: a parallel-route slot with no matching segment for the current
 *  URL needs a `default.tsx`, or the whole layout 404s. */
export default function Default() {
  return null;
}
