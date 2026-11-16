import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => JSON.parse(readFileSync(path.resolve(__dirname, rel), "utf8"));

// The root vitest config runs apps/web as a project, so it resolves jsdom from the root
// node_modules. If the two ranges drift, npm nests one copy under apps/web/node_modules and
// every web test file fails to start with "Cannot find package 'jsdom'".
describe("jsdom hoisting", () => {
  it("declares the same jsdom range at the root and in apps/web", () => {
    const root = read("../../../package.json").devDependencies.jsdom;
    const web = read("../package.json").devDependencies.jsdom;
    expect(root).toBeTruthy();
    expect(root).toBe(web);
  });
});
