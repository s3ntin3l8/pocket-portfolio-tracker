// Rasterises the brand glyph into the PNG sizes a PWA needs. Run once after changing
// the icon; the outputs in public/icons are committed so production builds need no
// image tooling. Usage: `npm run generate-icons --workspace @portfolio/web`.
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const iconsDir = join(publicDir, "icons");

// Rounded tile (transparent corners) — fine for "any"-purpose icons + favicon.
const roundedSvg = await readFile(join(publicDir, "icon.svg"));
// Full-bleed opaque square — for maskable (OS applies its own mask) and apple-touch
// (iOS rounds the corners itself). The glyph already sits inside the maskable safe zone.
const squareSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<rect width="64" height="64" fill="#0a0a0a"/>` +
    `<path d="M20 44V20h12a8 8 0 0 1 0 16h-6v8z" fill="#34d399"/></svg>`,
);

await mkdir(iconsDir, { recursive: true });

const render = (input, size, out) =>
  sharp(input, { density: 512 })
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, out));

await Promise.all([
  render(roundedSvg, 192, "icon-192.png"),
  render(roundedSvg, 512, "icon-512.png"),
  render(squareSvg, 512, "maskable-512.png"),
  render(squareSvg, 180, "apple-touch-icon.png"),
]);

console.log("Generated PWA icons → public/icons/");
