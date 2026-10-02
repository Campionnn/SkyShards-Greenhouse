import { toPng } from 'html-to-image';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { decodeApngFrames } from './apng';

// Crops whose icon is an APNG. Each frame lasts 1s, matching the 1 fps GIF
// export. Frame counts are read from the files themselves.
export const ANIMATED_CROPS: ReadonlySet<string> = new Set([
  'all_in_aloe',
  'fire',
  'noctilume',
  'shellfruit',
  'startlevine',
]);

export interface CropInfo {
  cropId: string;
  cropName: string;
  count: number;
}

export interface ExportOptions {
  scale: number;
  includeWatermark: boolean;
  watermarkUrl: string;
  watermarkTitle: string;
  inputCrops: CropInfo[];
  targetCrops: CropInfo[];
  showTargets: boolean;
  // Per-crop icon frames and the frame to draw, for GIF exports.
  animatedFrames?: Map<string, HTMLCanvasElement[]>;
  frameIndex?: number;
}

export interface ExportResult {
  blob: Blob;
  dataUrl: string;
}

const cropImageCache = new Map<string, HTMLImageElement>();

// Decoded APNG frames, keyed by URL.
const animatedFrameCache = new Map<string, HTMLCanvasElement[]>();

/** Loads a crop icon (cached); resolves null on failure. */
async function loadCropImage(cropId: string): Promise<HTMLImageElement | null> {
  if (cropImageCache.has(cropId)) {
    return cropImageCache.get(cropId)!;
  }
  
  const url = `/greenhouse/crops/${cropId}.png`;
  
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
    
    cropImageCache.set(cropId, img);
    return img;
  } catch {
    console.warn(`Failed to load crop image: ${cropId}`);
    return null;
  }
}

/** Pre-loads the footer's crop icons. Currently unused. */
async function _preloadCropImages(cropInfos: CropInfo[]): Promise<Map<string, HTMLImageElement>> {
  const imageMap = new Map<string, HTMLImageElement>();
  
  await Promise.all(
    cropInfos.map(async (info) => {
      const img = await loadCropImage(info.cropId);
      if (img) {
        imageMap.set(info.cropId, img);
      }
    })
  );
  
  return imageMap;
}

void _preloadCropImages;

/** Decodes every frame of an APNG to canvases (cached); empty on failure. */
async function extractAnimatedFrames(url: string): Promise<HTMLCanvasElement[]> {
  const cached = animatedFrameCache.get(url);
  if (cached) return cached;

  try {
    const canvases = await decodeApngFrames(url);
    animatedFrameCache.set(url, canvases);
    return canvases;
  } catch (error) {
    console.error('Failed to extract animated frames:', error);
    return [];
  }
}

/** Draws bold text with a 1px drop shadow. */
function drawPixelatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string = '#ffffff',
  align: CanvasTextAlign = 'left'
): void {
  ctx.save();
  ctx.font = `bold ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillText(text, x + 1, y + 1);
  
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Builds a rounded-rectangle path. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Footer layout metrics. Targets are always listed, regardless of showTargets. */
function calculateFooterHeight(
  inputCrops: CropInfo[],
  targetCrops: CropInfo[],
  scale: number,
  canvasWidth: number
): { height: number; itemHeight: number; itemsPerRow: number; padding: number; sectionGap: number } {
  const padding = 18 * scale;
  const sectionGap = 14 * scale;
  const itemHeight = 32 * scale;
  const itemWidth = 145 * scale;
  const sectionHeaderHeight = 22 * scale;
  
  const availableWidth = canvasWidth - (padding * 2);
  const itemsPerRow = Math.max(1, Math.floor(availableWidth / itemWidth));
  
  const inputRows = inputCrops.length > 0 ? Math.ceil(inputCrops.length / itemsPerRow) : 0;
  const targetRows = targetCrops.length > 0 ? Math.ceil(targetCrops.length / itemsPerRow) : 0;
  
  let height = padding;
  
  // Targets section comes before inputs.
  if (targetRows > 0) {
    height += sectionHeaderHeight + (targetRows * itemHeight);
  }
  
  if (inputRows > 0) {
    if (targetRows > 0) height += sectionGap;
    height += sectionHeaderHeight + (inputRows * itemHeight);
  }
  
  if (inputRows > 0 || targetRows > 0) {
    height += padding;
  } else {
    height = 0;
  }
  
  return { height, itemHeight, itemsPerRow, padding, sectionGap };
}

/** Wraps the grid canvas with a title header and a crop-count footer. */
async function addOverlay(
  canvas: HTMLCanvasElement,
  options: ExportOptions
): Promise<HTMLCanvasElement> {
  const { watermarkUrl, watermarkTitle, inputCrops, targetCrops, scale, animatedFrames, frameIndex } = options;
  
  const headerHeight = 38 * scale;
  const headerPadding = 16 * scale;
  const outerPadding = 20 * scale; // around the whole image
  const gridPadding = 24 * scale; // extra, around the grid only
  const totalWidth = canvas.width + (gridPadding * 2);
  const { height: footerHeight, itemHeight, itemsPerRow, padding, sectionGap } = calculateFooterHeight(
    inputCrops, targetCrops, scale, totalWidth
  );
  
  // Target icons are loaded even when targets are hidden on the grid.
  const allCrops = [...inputCrops, ...targetCrops];
  const cropImages = new Map<string, HTMLImageElement | HTMLCanvasElement>();
  
  // Prefer the current animation frame; fall back to the static icon.
  for (const crop of allCrops) {
    if (animatedFrames && frameIndex !== undefined) {
      const frames = animatedFrames.get(crop.cropId);
      if (frames && frames.length > 0) {
        cropImages.set(crop.cropId, frames[frameIndex % frames.length]);
        continue;
      }
    }
    const img = await loadCropImage(crop.cropId);
    if (img) {
      cropImages.set(crop.cropId, img);
    }
  }
  
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = canvas.width + (gridPadding * 2) + (outerPadding * 2);
  outputCanvas.height = canvas.height + headerHeight + footerHeight + (gridPadding * 2) + (outerPadding * 2);
  
  const ctx = outputCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  
  ctx.fillStyle = 'rgba(15, 23, 42, 1)';
  ctx.fillRect(outerPadding, outerPadding, outputCanvas.width - (outerPadding * 2), headerHeight);
  
  const headerFontSize = 24 * scale;
  drawPixelatedText(ctx, watermarkTitle, outerPadding + headerPadding, outerPadding + (headerHeight - headerFontSize) / 2, headerFontSize, '#e2e8f0');
  const urlFontSize = 14 * scale;
  drawPixelatedText(ctx, watermarkUrl, outputCanvas.width - outerPadding - headerPadding, outerPadding + (headerHeight - urlFontSize) / 2 + 2, urlFontSize, '#6ee7b7', 'right');
  
  ctx.drawImage(canvas, outerPadding + gridPadding, outerPadding + headerHeight + gridPadding);
  
  if (footerHeight > 0) {
    const footerY = outerPadding + headerHeight + canvas.height + (gridPadding * 2);
    
    ctx.fillStyle = 'rgba(15, 23, 42, 1)';
    ctx.fillRect(outerPadding, footerY, outputCanvas.width - (outerPadding * 2), footerHeight);
    
    const iconSize = 20 * scale;
    const nameFontSize = 11 * scale;
    const countFontSize = 10 * scale;
    const sectionFontSize = 10 * scale;
    const itemGap = 8 * scale;
    const itemWidth = (outputCanvas.width - (outerPadding * 2) - padding * 2 - (itemsPerRow - 1) * itemGap) / itemsPerRow;
    
    let currentY = footerY + padding;
    
    const drawCropItem = (
      crop: CropInfo,
      x: number,
      y: number,
      bgColor: string,
      countColor: string
    ) => {
      const itemPadding = 4 * scale;
      const boxHeight = itemHeight - 4 * scale;
      
      ctx.fillStyle = bgColor;
      roundRect(ctx, x, y, itemWidth, boxHeight, 4 * scale);
      ctx.fill();
      
      const img = cropImages.get(crop.cropId);
      if (img) {
        ctx.drawImage(img, x + itemPadding, y + (boxHeight - iconSize) / 2, iconSize, iconSize);
      } else {
        ctx.fillStyle = '#334155';
        ctx.fillRect(x + itemPadding, y + (boxHeight - iconSize) / 2, iconSize, iconSize);
      }
      
      const textX = x + itemPadding + iconSize + 4 * scale;
      const textY = y + (boxHeight - nameFontSize) / 2;
      const maxNameWidth = itemWidth - iconSize - itemPadding * 2 - 30 * scale;
      
      ctx.save();
      ctx.font = `${nameFontSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = '#e2e8f0';
      ctx.textBaseline = 'top';
      
      let displayName = crop.cropName;
      while (ctx.measureText(displayName).width > maxNameWidth && displayName.length > 3) {
        displayName = displayName.slice(0, -1);
      }
      if (displayName !== crop.cropName) displayName += '…';
      
      ctx.fillText(displayName, textX, textY);
      ctx.restore();
      
      const countText = `x${crop.count}`;
      drawPixelatedText(ctx, countText, x + itemWidth - itemPadding, textY, countFontSize, countColor, 'right');
    };
    
    // Targets first, shown even when hidden on the grid.
    if (targetCrops.length > 0) {
      const targetTotal = targetCrops.reduce((sum, c) => sum + c.count, 0);
      drawPixelatedText(ctx, `TARGETS (${targetTotal})`, outerPadding + padding, currentY, sectionFontSize, '#a78bfa');
      currentY += 20 * scale;
      
      targetCrops.forEach((crop, index) => {
        const row = Math.floor(index / itemsPerRow);
        const col = index % itemsPerRow;
        const x = outerPadding + padding + col * (itemWidth + itemGap);
        const y = currentY + row * itemHeight;
        drawCropItem(crop, x, y, 'rgba(167, 139, 250, 0.15)', '#a78bfa');
      });
      
      const targetRows = Math.ceil(targetCrops.length / itemsPerRow);
      currentY += targetRows * itemHeight;
    }
    
    if (inputCrops.length > 0) {
      if (targetCrops.length > 0) currentY += sectionGap;
      
      const inputTotal = inputCrops.reduce((sum, c) => sum + c.count, 0);
      drawPixelatedText(ctx, `INPUTS (${inputTotal})`, outerPadding + padding, currentY, sectionFontSize, '#22c55e');
      currentY += 20 * scale;
      
      inputCrops.forEach((crop, index) => {
        const row = Math.floor(index / itemsPerRow);
        const col = index % itemsPerRow;
        const x = outerPadding + padding + col * (itemWidth + itemGap);
        const y = currentY + row * itemHeight;
        drawCropItem(crop, x, y, 'rgba(34, 197, 94, 0.15)', '#22c55e');
      });
    }
  }
  
  return outputCanvas;
}

/** Captures the grid element as a PNG, optionally with the overlay. */
export async function captureGridAsPng(
  element: HTMLElement,
  options: ExportOptions
): Promise<ExportResult> {
  const { scale } = options;
  
  // Exports are normalised to a fixed size so they match across devices:
  // 10 cells * 48px + 9 gaps * 2px = 498px.
  const FIXED_GRID_SIZE = 498;
  
  const actualWidth = element.offsetWidth;
  const actualHeight = element.offsetHeight;
  
  const scaleToFixed = FIXED_GRID_SIZE / actualWidth;
  
  const dataUrl = await toPng(element, {
    pixelRatio: scale * scaleToFixed,
    backgroundColor: '#1e293b',
    cacheBust: true,
    skipAutoScale: true,
    includeQueryParams: true,
    skipFonts: true,
    width: actualWidth,
    height: actualHeight,
    filter: (node) => {
      if (node instanceof Element) {
        const tagName = node.tagName?.toLowerCase();
        if (tagName === 'script' || tagName === 'noscript') {
          return false;
        }
        if (node.hasAttribute('data-gif-exclude')) {
          return false;
        }
      }
      return true;
    },
  });
  
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });
  
  const canvas = document.createElement('canvas');
  canvas.width = FIXED_GRID_SIZE * scale;
  canvas.height = FIXED_GRID_SIZE * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  
  const outputCanvas = options.includeWatermark 
    ? await addOverlay(canvas, options)
    : canvas;
  
  const blob = await new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob((b: Blob | null) => {
      if (b) resolve(b);
      else reject(new Error('Failed to create blob'));
    }, 'image/png');
  });
  
  return {
    blob,
    dataUrl: outputCanvas.toDataURL('image/png'),
  };
}

/** True if any of the crop ids has an animated icon. */
export function hasAnimatedCrops(cropIds: string[]): boolean {
  return cropIds.some(id => ANIMATED_CROPS.has(id));
}

/** LCM of the frame counts, so every animation loops a whole number of times. */
export function getLcmFrameCount(frameCounts: number[]): number {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);
  return frameCounts.reduce((acc, val) => lcm(acc, val), 1);
}

/** Decodes icon frames for every animated crop among the ids. */
async function preloadAnimatedFrames(cropIds: string[]): Promise<Map<string, HTMLCanvasElement[]>> {
  const uniqueIds = [...new Set(cropIds.filter(id => ANIMATED_CROPS.has(id)))];
  
  const frameMap = new Map<string, HTMLCanvasElement[]>();
  
  await Promise.all(
    uniqueIds.map(async (cropId) => {
      const url = `/greenhouse/crops/${cropId}.png`;
      const frames = await extractAnimatedFrames(url);
      if (frames.length > 0) {
        frameMap.set(cropId, frames);
      }
    })
  );
  
  return frameMap;
}

/** Builds one 256-colour palette shared by all frames (like ffmpeg palettegen). */
function generateGlobalPalette(frames: HTMLCanvasElement[]): number[][] {
  const allPixels: number[] = [];
  const sampleRate = Math.max(1, Math.floor(frames.length / 3));
  
  for (let i = 0; i < frames.length; i += sampleRate) {
    const canvas = frames[i];
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Every 4th pixel (16 bytes) is enough for quantisation.
    for (let j = 0; j < imageData.data.length; j += 16) {
      allPixels.push(
        imageData.data[j],
        imageData.data[j + 1],
        imageData.data[j + 2],
        imageData.data[j + 3]
      );
    }
  }
  
  const palette = quantize(new Uint8Array(allPixels), 256, {
    format: 'rgba4444',
    oneBitAlpha: true,
  });
  
  return palette;
}

/** Captures the grid as an animated GIF (gifenc, Discord-compatible). */
export async function captureGridAsGif(
  element: HTMLElement,
  options: ExportOptions,
  cropIds: string[],
  onProgress?: (progress: number) => void
): Promise<ExportResult> {
  const { scale } = options;
  
  onProgress?.(5);
  
  const animatedFrames = await preloadAnimatedFrames(cropIds);
  const totalFrames = getLcmFrameCount([...animatedFrames.values()].map(f => f.length));
  
  onProgress?.(15);
  
  // <img> elements showing animated icons; their src is swapped per frame.
  const animatedImgInfo: Array<{
    img: HTMLImageElement;
    cropId: string;
    originalSrc: string;
  }> = [];
  
  const imgs = Array.from(element.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.src;
    for (const cropId of ANIMATED_CROPS) {
      if (src.includes(`/${cropId}.png`) && animatedFrames.has(cropId)) {
        animatedImgInfo.push({ img, cropId, originalSrc: src });
        break;
      }
    }
  }
  
  const originalSources = new Map<HTMLImageElement, string>();
  for (const info of animatedImgInfo) {
    originalSources.set(info.img, info.img.src);
  }
  
  // Fixed export size; see captureGridAsPng.
  const FIXED_GRID_SIZE = 498;
  
  const actualWidth = element.offsetWidth;
  const actualHeight = element.offsetHeight;
  
  const scaleToFixed = FIXED_GRID_SIZE / actualWidth;
  
  const frameCanvases: HTMLCanvasElement[] = [];
  
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const progressPercent = 15 + ((frameIndex / totalFrames) * 35);
    onProgress?.(progressPercent);
    
    for (const info of animatedImgInfo) {
      const frames = animatedFrames.get(info.cropId);
      if (frames && frames.length > 0) {
        info.img.src = frames[frameIndex % frames.length].toDataURL('image/png');
      }
    }
    
    // Let the swapped image sources render before capturing.
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const dataUrl = await toPng(element, {
      pixelRatio: scale * scaleToFixed,
      backgroundColor: '#1e293b',
      cacheBust: true,
      skipAutoScale: true,
      includeQueryParams: true,
      skipFonts: true,
      width: actualWidth,
      height: actualHeight,
      filter: (node) => {
        if (node instanceof Element) {
          const tagName = node.tagName?.toLowerCase();
          if (tagName === 'script' || tagName === 'noscript') {
            return false;
          }
        }
        return true;
      },
    });
    
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });
    
    const canvas = document.createElement('canvas');
    canvas.width = FIXED_GRID_SIZE * scale;
    canvas.height = FIXED_GRID_SIZE * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Footer icons use the same frame index as the grid.
    const outputCanvas = options.includeWatermark
      ? await addOverlay(canvas, { ...options, animatedFrames, frameIndex })
      : canvas;
    
    frameCanvases.push(outputCanvas);
  }
  
  for (const info of animatedImgInfo) {
    info.img.src = info.originalSrc;
  }
  
  onProgress?.(50);
  
  if (frameCanvases.length === 0) {
    throw new Error('No frames captured');
  }
  
  const palette = generateGlobalPalette(frameCanvases);
  
  onProgress?.(60);
  
  const width = frameCanvases[0].width;
  const height = frameCanvases[0].height;
  const gif = GIFEncoder();
  
  for (let i = 0; i < frameCanvases.length; i++) {
    const progressPercent = 60 + ((i / frameCanvases.length) * 35);
    onProgress?.(progressPercent);
    
    const canvas = frameCanvases[i];
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, width, height);
    
    // No dithering (like ffmpeg paletteuse dither=none).
    const index = applyPalette(imageData.data, palette);
    
    gif.writeFrame(index, width, height, {
      palette,
      delay: 1000, // 1 fps
      dispose: 1, // keep previous frame; most widely supported
    });
  }
  
  gif.finish();
  
  onProgress?.(95);
  
  const bytes = gif.bytes();
  const blob = new Blob([bytes], { type: 'image/gif' });
  
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read GIF blob'));
    reader.readAsDataURL(blob);
  });
  
  onProgress?.(100);
  
  return { blob, dataUrl };
}

/** Copies a PNG blob to the clipboard. Returns false for other types or on failure. */
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || !navigator.clipboard.write) {
      return false;
    }
    
    if (blob.type === 'image/png') {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      return true;
    }
    
    // Browsers do not reliably accept GIFs on the clipboard.
    return false;
  } catch {
    return false;
  }
}

/** Triggers a browser download of the blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Counts placements per crop, in first-seen order. */
export function aggregateCropInfo(
  placements: Array<{ cropId: string; cropName: string }>
): CropInfo[] {
  const counts = new Map<string, { cropName: string; count: number }>();
  
  for (const p of placements) {
    const existing = counts.get(p.cropId);
    if (existing) {
      existing.count++;
    } else {
      counts.set(p.cropId, { cropName: p.cropName, count: 1 });
    }
  }
  
  return Array.from(counts.entries()).map(([cropId, { cropName, count }]) => ({
    cropId,
    cropName,
    count,
  }));
}
