export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events reader over a fetch body. Frames are separated by a blank
 * line; `data:` lines of one frame are joined with `\n`; comment lines (`:`) are ignored.
 * Both `\n` and `\r\n` line endings are accepted.
 */
export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  /** Called for every chunk read, including ones that only carry comments (keepalives). */
  onChunk?: () => void,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      // Normalise after appending so a CRLF split across two chunks still collapses.
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = parseFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (frame) yield frame;
      }
    }
    buf += decoder.decode().replace(/\r\n/g, "\n");
    const last = parseFrame(buf);
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

/**
 * Abort signal that also fires when no chunk has arrived for `ms`. Call `touch()` on every
 * frame and `stop()` when the stream ends so the timer never outlives the request.
 */
export function idleGuard(signal: AbortSignal | undefined, ms: number) {
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), ms);
  };
  touch();
  return {
    signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal,
    touch,
    stop: () => clearTimeout(timer),
  };
}
