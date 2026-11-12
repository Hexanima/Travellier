import { describe, expect, it, vi } from "vitest";
import { createBrowserImageCodec } from "./image-codec.js";

function setup(toBlobResult: Blob | null = new Blob(["x"], { type: "image/jpeg" })) {
  const calls: string[] = [];
  const context = { fillStyle: "", fillRect: vi.fn((...args: number[]) => calls.push(`fill:${context.fillStyle}:${args.join(",")}`)),
    drawImage: vi.fn((_image: unknown, ...args: number[]) => calls.push(`draw:${args.join(",")}`)) };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(toBlobResult)) };
  const bitmap = { width: 4000, height: 3000, close: vi.fn() };
  const createImageBitmap = vi.fn(async () => bitmap);
  const codec = createBrowserImageCodec({ createImageBitmap, createCanvas: () => canvas });
  return { codec, canvas, context, bitmap, createImageBitmap, calls };
}

describe("browser image codec", () => {
  it("decodes keeping the visual orientation", async () => {
    const { codec, createImageBitmap, bitmap } = setup();
    const blob = new Blob(["a"]);
    const image = await codec.decode(blob);
    expect(createImageBitmap).toHaveBeenCalledWith(blob, { imageOrientation: "from-image" });
    expect(image).toBe(bitmap);
  });
  it("scales the long side down, paints a white background first and encodes JPEG at the quality", async () => {
    const { codec, canvas, bitmap, calls } = setup();
    const out = await codec.encode(bitmap, { maxSide: 2000, quality: 0.7 });
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1500);
    expect(calls).toEqual(["fill:#ffffff:0,0,2000,1500", "draw:0,0,2000,1500"]);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.7);
    expect(out?.type).toBe("image/jpeg");
  });
  it("never enlarges the image", async () => {
    const { codec, canvas, bitmap } = setup();
    await codec.encode(bitmap, { maxSide: 8000, quality: 0.9 });
    expect([canvas.width, canvas.height]).toEqual([4000, 3000]);
  });
  it("returns undefined when the canvas yields nothing or has no context", async () => {
    const empty = setup(null);
    expect(await empty.codec.encode(empty.bitmap, { maxSide: 100, quality: 0.5 })).toBeUndefined();
    const none = setup();
    none.canvas.getContext.mockReturnValue(null as never);
    expect(await none.codec.encode(none.bitmap, { maxSide: 100, quality: 0.5 })).toBeUndefined();
  });
});
