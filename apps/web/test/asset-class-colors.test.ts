import { describe, expect, it } from "vitest";
import { ASSET_CLASSES } from "../src/components/add-transaction-form/constants";
import { assetClassColor } from "../src/lib/asset-class-colors";

describe("assetClassColor", () => {
  it("assigns a semantic color to every selectable asset class", () => {
    const fallback = "fallback-color";

    for (const assetClass of ASSET_CLASSES) {
      expect(assetClassColor(assetClass, fallback), assetClass).not.toBe(fallback);
    }
  });
});
