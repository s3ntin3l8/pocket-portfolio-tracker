import { describe, expect, it } from "vitest";
import { isLocalUrl } from "../../../src/services/chat/local-url.js";

describe("isLocalUrl", () => {
  it.each([
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://10.0.0.5:8080",
    "http://172.16.3.4",
    "http://172.31.255.1",
    "http://192.168.0.9:11434",
    "http://169.254.1.1",
    "http://[::1]:11434",
    "http://[fd12::1]",
    "http://[fe80::1]",
    "http://[fe81::1]", // fe80::/10 spans fe80–febf
    "http://[febf::1]",
    "http://ollama:11434", // Docker service name
    "http://host.docker.internal:11434",
    "http://nas.local:11434",
    "http://gpu.internal",
  ])("treats %s as local", (url) => expect(isLocalUrl(url)).toBe(true));

  it.each([
    "https://ollama.example.com",
    "http://8.8.8.8:11434",
    "http://172.32.0.1", // just outside 172.16/12
    "http://[2001:db8::1]",
    "http://[fec0::1]", // deprecated site-local, outside fe80::/10
    "not a url",
    "",
  ])("treats %s as not local", (url) => expect(isLocalUrl(url)).toBe(false));
});
