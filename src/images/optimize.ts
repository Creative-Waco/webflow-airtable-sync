import {
  MAX_IMAGE_DOWNLOAD_BYTES,
  MAX_WEBFLOW_ASSET_BYTES,
} from "../constants";

const INITIAL_MAX_EDGE = 2560;
const MIN_MAX_EDGE = 640;
const INITIAL_JPEG_QUALITY = 88;
const MIN_JPEG_QUALITY = 42;
const OPTIMIZE_ITER_CAP = 96;

export interface OptimizeResult {
  bytes: ArrayBuffer;
  fileName: string;
  originalBytes: number;
  optimized: boolean;
}

function toJpegFileName(name: string): string {
  const stem = name.replace(/\.[^/.]+$/i, "") || "airtable-sync";
  return `${stem.slice(0, 180)}.jpg`;
}

function toImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

async function decodeImage(bytes: ArrayBuffer): Promise<ImageData> {
  const pngDecode = (await import("@jsquash/png/decode")).default;
  const jpegDecode = (await import("@jsquash/jpeg/decode")).default;

  try {
    return await pngDecode(bytes);
  } catch {
    return await jpegDecode(bytes);
  }
}

async function encodeJpeg(image: ImageData, quality: number): Promise<ArrayBuffer> {
  const jpegEncode = (await import("@jsquash/jpeg/encode")).default;
  return jpegEncode(image, { quality });
}

async function resizeImage(image: ImageData, maxEdge: number): Promise<ImageData> {
  const resize = (await import("@jsquash/resize")).default;
  const longEdge = Math.max(image.width, image.height);
  if (longEdge <= maxEdge) return image;

  const scale = maxEdge / longEdge;
  const newWidth = Math.max(1, Math.round(image.width * scale));
  const newHeight = Math.max(1, Math.round(image.height * scale));
  return resize(image, {
    width: newWidth,
    height: newHeight,
    method: "triangle",
    fitMethod: "stretch",
    premultiply: true,
    linearRGB: false,
  });
}

async function optimizeRasterBelowLimit(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  let image = await decodeImage(bytes);
  let maxEdge = INITIAL_MAX_EDGE;
  let quality = INITIAL_JPEG_QUALITY;
  let lastOut: ArrayBuffer | null = null;

  for (let i = 0; i < OPTIMIZE_ITER_CAP; i++) {
    const resized = await resizeImage(image, maxEdge);
    const out = await encodeJpeg(resized, quality);
    lastOut = out;

    if (out.byteLength <= MAX_WEBFLOW_ASSET_BYTES) return out;

    const overRatio = out.byteLength / MAX_WEBFLOW_ASSET_BYTES;
    if (overRatio > 1.45 && quality > MIN_JPEG_QUALITY + 10) {
      quality = Math.max(MIN_JPEG_QUALITY, quality - 14);
      continue;
    }
    if (overRatio > 1.18 && quality > MIN_JPEG_QUALITY + 5) {
      quality -= 5;
      continue;
    }
    if (quality > MIN_JPEG_QUALITY + 4) {
      quality -= 4;
      continue;
    }
    if (maxEdge > MIN_MAX_EDGE + 48) {
      maxEdge = Math.max(MIN_MAX_EDGE, Math.floor(maxEdge * (overRatio > 1.65 ? 0.72 : 0.82)));
      quality = INITIAL_JPEG_QUALITY;
      image = resized;
      continue;
    }
    quality = Math.max(MIN_JPEG_QUALITY, quality - 3);
  }

  throw new Error(
    `Could not shrink image below ${MAX_WEBFLOW_ASSET_BYTES} bytes (last ${lastOut?.byteLength ?? 0})`,
  );
}

export async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Image download failed HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("Empty image response");
  if (bytes.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
    throw new Error(`Image download exceeds ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
  }
  return bytes;
}

export async function prepareImageForWebflow(
  imageUrl: string,
  fileNameHint: string,
): Promise<OptimizeResult> {
  let bytes = await downloadImage(imageUrl);
  const originalBytes = bytes.byteLength;
  let fileName = fileNameHint;
  let optimized = false;

  if (bytes.byteLength > MAX_WEBFLOW_ASSET_BYTES) {
    bytes = await optimizeRasterBelowLimit(bytes);
    fileName = toJpegFileName(fileName);
    optimized = true;
  }

  if (bytes.byteLength > MAX_WEBFLOW_ASSET_BYTES) {
    throw new Error(`Image still exceeds ${MAX_WEBFLOW_ASSET_BYTES} bytes after optimization`);
  }

  return { bytes, fileName, originalBytes, optimized };
}

/** @internal exported for tests */
export { toImageData };
