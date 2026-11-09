import { describe, expect, it } from "vitest";
import { activityOptionLabel, excludedPostIds, linkSummary, postOptionLabel } from "./post-link-options.js";

const node = (id: string, parentPostId: string | null = null) => ({ id, parentPostId });
describe("excludedPostIds", () => {
  const posts = [node("root"), node("child", "root"), node("grandchild", "child"), node("branch", "root"), node("sibling"), node("ancestor-of-x"), node("x", "ancestor-of-x"), node("deep", "x")];
  it("includes the post itself, its children, grandchildren and branches", () => {
    expect([...excludedPostIds(posts, "root")].sort()).toEqual(["branch", "child", "grandchild", "root"]);
  });
  it("excludes siblings and ancestors of the edited post", () => {
    const excluded = excludedPostIds(posts, "x");
    expect([...excluded].sort()).toEqual(["deep", "x"]);
    expect(excluded.has("ancestor-of-x")).toBe(false); expect(excluded.has("sibling")).toBe(false);
  });
  it("does not hang with a cycle in old data and still returns the members reachable from the post", () => {
    const cyclic = [node("a", "c"), node("b", "a"), node("c", "b"), node("z")];
    expect([...excludedPostIds(cyclic, "a")].sort()).toEqual(["a", "b", "c"]);
  });
  it("excludes nothing when creating (no own post)", () => {
    expect(excludedPostIds(posts).size).toBe(0);
  });
  it("still excludes the id when the post is not in the list", () => {
    expect([...excludedPostIds([node("other")], "missing")]).toEqual(["missing"]);
  });
});
describe("option labels", () => {
  it("names a post without text and truncates long text", () => {
    expect(postOptionLabel({ description: null })).toBe("Recuerdo sin texto");
    expect(postOptionLabel({ description: "   " })).toBe("Recuerdo sin texto");
    expect(postOptionLabel({ description: "Atardecer" })).toBe("Atardecer");
    const long = postOptionLabel({ description: "a".repeat(100) });
    expect(long.length).toBeLessThanOrEqual(61); expect(long.endsWith("…")).toBe(true);
  });
  it("summarizes the link", () => {
    expect(linkSummary(null)).toBe("Sin vínculo");
    expect(linkSummary({ kind: "post", label: "Atardecer" })).toBe("Recuerdo: Atardecer");
    expect(linkSummary({ kind: "activity", label: "Paseo" })).toBe("Actividad: Paseo");
    expect(linkSummary({ kind: "post" })).toBe("Recuerdo: recuerdo seleccionado");
  });
  it("shows the activity title with date and time in the given zone", () => {
    const label = activityOptionLabel({ title: "Paseo", scheduledAt: "2026-09-25T15:30:00.000Z" }, "America/Argentina/Buenos_Aires");
    expect(label).toContain("Paseo"); expect(label).toContain("12:30"); expect(label).toMatch(/25/);
  });
});
