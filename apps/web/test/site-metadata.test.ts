import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { buildSiteMetadata } from "@/lib/site-metadata";

const t = (key: string) => `t:${key}`;
const build = (locale: string) =>
  buildSiteMetadata({ locale, baseUrl: "https://pocket.example.com", t });

describe("buildSiteMetadata", () => {
  it("sets an absolute metadataBase", () => {
    expect(String(build("en").metadataBase)).toBe("https://pocket.example.com/");
  });

  it("emits a 1200x630 Open Graph image with alt text", () => {
    const og = build("en").openGraph as { images: Array<Record<string, unknown>>; locale: string };
    expect(og.images[0]).toEqual({
      url: "/og-image.jpg",
      width: 1200,
      height: 630,
      alt: "t:ogImageAlt",
    });
    expect(og.locale).toBe("en_US");
  });

  it("uses a large Twitter card and maps the id locale", () => {
    const m = build("id");
    expect((m.twitter as { card: string }).card).toBe("summary_large_image");
    expect((m.openGraph as { locale: string }).locale).toBe("id_ID");
  });

  it("ships the committed og-image.jpg at 1200x630", async () => {
    const file = join(__dirname, "..", "public", "og-image.jpg");
    expect(existsSync(file)).toBe(true);
    const meta = await sharp(file).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
  });
});
