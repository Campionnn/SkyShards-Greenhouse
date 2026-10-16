import { cropImageUrls, groundImageDataUrls } from "virtual:greenhouse-images";

// Decoded images are kept referenced for the lifetime of the page so the browser keeps
// them in its in-memory image cache: a later <img> or background-image with the same URL
// then paints on the first frame instead of waiting on the network or a revalidation.
const loaded = new Map<string, Promise<void>>();
const retained: HTMLImageElement[] = [];

export function preloadImage(url: string): Promise<void> {
  const existing = loaded.get(url);
  if (existing) return existing;
  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // decode() rejects for some valid images in some browsers; loading is enough then.
      (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => resolve());
    };
    img.onerror = () => {
      loaded.delete(url); // allow a later retry
      resolve();
    };
    img.src = url;
    retained.push(img);
  });
  loaded.set(url, promise);
  return promise;
}

let started: Promise<void> | null = null;

/**
 * Loads and decodes every crop, mutation and ground image once per page load. Ground
 * textures are inlined data URLs (no network), but decoding them up front still avoids a
 * blank first frame.
 */
export function preloadAllGreenhouseImages(): Promise<void> {
  if (!started) {
    started = Promise.all(Object.values(groundImageDataUrls).map(preloadImage))
      .then(() => Promise.all(cropImageUrls.map(preloadImage)))
      .then(() => {});
  }
  return started;
}
