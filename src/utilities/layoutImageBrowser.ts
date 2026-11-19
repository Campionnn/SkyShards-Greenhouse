import { getCropImagePath, getGroundImagePath } from "../types/greenhouse";
import { drawLayoutImage, measureLayoutImage, type ImageAsset, type LayoutImageModel, type LayoutImagePlacement } from "./layoutImage";

/**
 * The layout image in the browser (the Designer's Export): the same drawing as the Discord share embed
 * (layoutImage.ts), on an offscreen canvas. Nothing is read from the page's grid.
 */

export interface LayoutImageResult {
  blob: Blob;
  /** An object URL of the blob; revoke it when done. */
  url: string;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** The Designer's placements as image placements (names and sizes come with them; grounds from the data). */
export function toImagePlacements(
  inputs: Array<{ cropId: string; cropName: string; size: number; position: [number, number] }>,
  targets: Array<{ cropId: string; cropName: string; size: number; position: [number, number] }>,
  groundOf: (cropId: string) => string,
): LayoutImagePlacement[] {
  const one = (kind: "input" | "target") => (p: (typeof inputs)[number]): LayoutImagePlacement => ({
    cropId: p.cropId,
    name: p.cropName,
    size: p.size,
    position: p.position,
    ground: groundOf(p.cropId),
    kind,
  });
  return [...inputs.map(one("input")), ...targets.map(one("target"))];
}

/** Renders the model to a PNG (2× by default). Waits for the icons and Inter; a missing icon draws as initials. */
export async function renderLayoutImage(model: LayoutImageModel, scale = 2): Promise<LayoutImageResult> {
  const cropIds = [...new Set(model.placements.map((p) => p.cropId))];
  const grounds = [...new Set([...model.placements.map((p) => p.ground), ...model.groundTiles.map((g) => g.ground)])];
  const [cropImgs, groundImgs, brand] = await Promise.all([
    Promise.all(cropIds.map((id) => loadImage(getCropImagePath(id)))),
    Promise.all(grounds.map((g) => loadImage(getGroundImagePath(g)))),
    loadImage("/brand/aloe-aqua-64.png"),
    ...["400 13px Inter", "500 13px Inter", "600 17px Inter", "700 15px Inter"].map((f) => document.fonts?.load(f).catch(() => undefined)),
  ]);
  const crop = new Map<string, ImageAsset | null>(cropIds.map((id, i) => [id, cropImgs[i]]));
  const ground = new Map<string, ImageAsset | null>(grounds.map((g, i) => [g, groundImgs[i]]));

  const { width, height } = measureLayoutImage(model);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  drawLayoutImage(ctx, model, { crop: (id) => crop.get(id), ground: (g) => ground.get(g), brand: () => brand }, scale);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create the image"))), "image/png"));
  return { blob, url: URL.createObjectURL(blob) };
}

/** Copies a PNG blob to the clipboard. False where the browser can't. */
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || blob.type !== "image/png") return false;
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Triggers a browser download of the blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A blob as a data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Failed to read the image"));
    r.readAsDataURL(blob);
  });
}
