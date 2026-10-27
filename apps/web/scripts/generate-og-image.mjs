// Renders the 1200x630 social-preview card (Open Graph / Twitter) into public/og-image.jpg.
// Run manually after changing the brand or the holdings screenshot; the output is committed
// so production builds need no image tooling. Usage:
//   npm run generate-og-image --workspace @portfolio/web
// Text is rasterised by librsvg using the host's fontconfig, so the result depends on the
// fonts installed when you run it (generic sans if Plus Jakarta Sans is missing).
import sharp from "sharp";
import { access, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const W = 1200;
const H = 630;

// Brand mark: lucide-react "Layers" (same paths as generate-icons.mjs / brand.tsx).
const LAYERS_PATHS = [
  "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
  "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
  "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
];
const FONT = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

// Screenshot panel: right side, rounded, bleeding off the right edge.
const SHOT = { x: 640, y: 150, w: 640, h: 360, r: 20 };

const background = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<defs><radialGradient id="g" cx="0.85" cy="0.1" r="0.9">` +
    `<stop offset="0" stop-color="#0e9f6e" stop-opacity="0.35"/>` +
    `<stop offset="1" stop-color="#0e9f6e" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="#0e1512"/><rect width="${W}" height="${H}" fill="url(#g)"/>` +
    `<rect x="${SHOT.x - 2}" y="${SHOT.y - 2}" width="${SHOT.w + 4}" height="${SHOT.h + 4}" rx="${SHOT.r + 2}" fill="#ffffff" fill-opacity="0.12"/>` +
    `</svg>`,
);

const chips = ["Stocks", "Funds", "Gold", "Bonds", "Cash"];
let chipX = 80;
const chipSvg = chips
  .map((label) => {
    const w = label.length * 11 + 36;
    const out =
      `<rect x="${chipX}" y="430" width="${w}" height="40" rx="20" fill="#ffffff" fill-opacity="0.08"/>` +
      `<text x="${chipX + w / 2}" y="456" font-family="${FONT}" font-size="18" fill="#c9d6cf" text-anchor="middle">${label}</text>`;
    chipX += w + 12;
    return out;
  })
  .join("");

const foreground = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect x="80" y="80" width="72" height="72" rx="17" fill="#0e9f6e"/>` +
    `<svg x="98" y="98" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    LAYERS_PATHS.map((d) => `<path d="${d}"/>`).join("") +
    `</svg>` +
    `<text x="172" y="130" font-family="${FONT}" font-size="46" font-weight="700" fill="#f4f7f5">Pocket</text>` +
    `<text x="80" y="268" font-family="${FONT}" font-size="54" font-weight="700" fill="#f4f7f5">Every asset,</text>` +
    `<text x="80" y="334" font-family="${FONT}" font-size="54" font-weight="700" fill="#0e9f6e">one clear number.</text>` +
    `<text x="80" y="388" font-family="${FONT}" font-size="22" fill="#9db0a6">Every brokerage in a single figure.</text>` +
    chipSvg +
    `</svg>`,
);

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SHOT.w}" height="${SHOT.h}">` +
    `<rect width="${SHOT.w}" height="${SHOT.h}" rx="${SHOT.r}" fill="#fff"/></svg>`,
);
const shotPath = join(publicDir, "screenshots", "holdings-dark-desktop.png");
await access(shotPath).catch(() => {
  throw new Error(`Missing ${shotPath} — generate it first (make screenshots).`);
});
const shot = await sharp(shotPath)
  .resize(SHOT.w, SHOT.h, { fit: "cover", position: "left top" })
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

const out = join(publicDir, "og-image.jpg");
await sharp(background)
  .composite([
    { input: shot, left: SHOT.x, top: SHOT.y },
    { input: foreground, left: 0, top: 0 },
  ])
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(out);

console.log(
  `Generated ${W}x${H} social card → public/og-image.jpg (${(await stat(out)).size} bytes)`,
);
