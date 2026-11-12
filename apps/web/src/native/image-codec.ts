/** Port that decodes and re-encodes images (T129); the browser implementation uses `createImageBitmap` and a canvas. */
export type DecodedImage = { width: number; height: number; close: () => void };
export type EncodeOptions = { maxSide: number; quality: number };
export type ImageCodec = {
  decode: (blob: Blob) => Promise<DecodedImage>;
  /** JPEG at the given quality with the long side capped at `maxSide` (never enlarged); `undefined` when the platform produced nothing. */
  encode: (image: DecodedImage, options: EncodeOptions) => Promise<Blob | undefined>;
};
export type CanvasContextLike = { fillStyle: string | CanvasGradient | CanvasPattern; fillRect: (x: number, y: number, width: number, height: number) => void;
  drawImage: (image: never, x: number, y: number, width: number, height: number) => void };
export type CanvasLike = { width: number; height: number; getContext: (type: "2d") => CanvasContextLike | null;
  toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void };
export type BrowserImageCodecDependencies = {
  createImageBitmap: (blob: Blob, options: { imageOrientation: "from-image" }) => Promise<DecodedImage>;
  createCanvas: () => CanvasLike;
};

export const createBrowserImageCodec = ({ createImageBitmap, createCanvas }: BrowserImageCodecDependencies): ImageCodec => ({
  decode: (blob) => createImageBitmap(blob, { imageOrientation: "from-image" }),
  encode: async (image, { maxSide, quality }) => {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas();
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) { canvas.width = 0; canvas.height = 0; return undefined; }
    // JPEG has no alpha: transparent PNG/WebP areas would turn black without a white background.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image as never, 0, 0, width, height);
    return new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => {
      // Free the backing store now: iOS WebKit caps total canvas memory and a later toBlob would return null.
      canvas.width = 0; canvas.height = 0;
      resolve(blob ?? undefined);
    }, "image/jpeg", quality));
  },
});
