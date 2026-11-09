import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * jsdom does not compute stacking, so this is a PROXY of the real stacking: it pins the CSS contract that keeps
 * the conflict modal above the activity dialog. Mounting inside `.participation-conflict-layer` is asserted in
 * ActivityForm.test.tsx and TripItineraryScreen.participation.test.tsx.
 */
const css = readFileSync(new URL("./itinerary.css", import.meta.url), "utf8");
const zIndexOf = (selector: string) => {
  const rule = css.split(/\r?\n/).find((line) => line.startsWith(`${selector} {`));
  const value = rule?.split("z-index:")[1]?.trim().replace(/[^0-9].*$/, "");
  return value ? Number(value) : undefined;
};

describe("participation conflict stacking contract", () => {
  it("keeps the conflict layer backdrop above the activity dialog backdrop", () => {
    const dialog = zIndexOf(".activity-dialog .ui-modal-backdrop");
    const layer = zIndexOf(".participation-conflict-layer .ui-modal-backdrop");
    expect(dialog).toBeTypeOf("number");
    expect(layer, "missing .participation-conflict-layer .ui-modal-backdrop z-index").toBeTypeOf("number");
    expect(layer!).toBeGreaterThan(dialog!);
  });
});
