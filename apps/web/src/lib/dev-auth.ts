/** True when the web app runs on the `DEV_AUTH_TOKEN` bypass (never in production). The one
 *  definition shared by the server API client, the sign-in page and Settings. Server-side only. */
export function isDevAuthBypass(): boolean {
  return process.env.NODE_ENV !== "production" && Boolean(process.env.DEV_AUTH_TOKEN);
}
