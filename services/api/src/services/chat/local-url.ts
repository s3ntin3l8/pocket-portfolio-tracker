import net from "node:net";

/**
 * Whether an LLM server URL points at the user's own infrastructure, so `/assistant/status`
 * can truthfully say "data stays local". Loopback, private/link-local addresses, `.local` /
 * `.internal` names and single-label hosts (a Docker service name, `host.docker.internal`)
 * count as local; anything else (a public hostname or address) does not.
 */
export function isLocalUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host === "host.docker.internal") return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (kind === 6) {
    // ::1, unique-local fc00::/7, link-local fe80::/10 (fe80–febf).
    return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return !host.includes(".") || host.endsWith(".local") || host.endsWith(".internal");
}
