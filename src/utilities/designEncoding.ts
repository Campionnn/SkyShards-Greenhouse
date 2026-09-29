import { deflateRaw, inflateRaw } from "pako";
import { CROP_IDS, MUTATION_IDS, CROP_TO_INDEX, MUTATION_TO_INDEX } from "../constants/cropMapping";

const GRID_SIZE = 10;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;

// Ground digits occupy otherwise empty cells; existing plant/target letters stay unchanged.
// Keep this order stable so previously shared designs always decode the same way.
export const GROUND_TYPES = ["farmland", "sand", "soul_sand", "mycelium", "netherrack", "end_stone"] as const;
export type GroundType = typeof GROUND_TYPES[number];
export type GroundTile = { ground: GroundType; position: [number, number] };

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const MAX_SINGLE_CROPS = 26; // a-z
const MAX_DOUBLE_CROPS = 26 * 26; // aa-zz = 676

function indexToDouble(idx: number): string {
  const first = LETTERS[Math.floor(idx / LETTERS.length)];
  const second = LETTERS[idx % LETTERS.length];
  return first + second;
}

function doubleToIndex(chars: string): number {
  const firstIdx = LETTERS.indexOf(chars[0].toLowerCase());
  const secondIdx = LETTERS.indexOf(chars[1].toLowerCase());
  if (firstIdx === -1 || secondIdx === -1) return -1;
  return firstIdx * LETTERS.length + secondIdx;
}

function toUrlSafeBase64(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafeBase64(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface GroupedPlacements {
  [cropId: string]: number[]; // positions as flat indices (row * 10 + col)
}

function groupPlacements(
  placements: Array<{ cropId: string; position: [number, number] }>
): GroupedPlacements {
  const grouped: GroupedPlacements = {};
  for (const p of placements) {
    if (!grouped[p.cropId]) grouped[p.cropId] = [];
    grouped[p.cropId].push(p.position[0] * GRID_SIZE + p.position[1]);
  }
  return grouped;
}

function encodeGridString(
  inputs: GroupedPlacements,
  targets: GroupedPlacements,
  groundTiles: GroundTile[]
): string {
  const inputCrops = Object.keys(inputs);
  const targetCrops = Object.keys(targets);

  const inputIndices: number[] = [];
  const inputCropsList: string[] = [];
  
  for (const cropId of inputCrops) {
    let idx = CROP_TO_INDEX[cropId];
    if (idx !== undefined) {
      inputIndices.push(idx);
      inputCropsList.push(cropId);
    } else {
      idx = MUTATION_TO_INDEX[cropId];
      if (idx !== undefined) {
        inputIndices.push(CROP_IDS.length + idx);
        inputCropsList.push(cropId);
      }
    }
  }

  const targetIndices: number[] = [];
  const targetCropsList: string[] = [];
  
  for (const mutationId of targetCrops) {
    const idx = MUTATION_TO_INDEX[mutationId];
    if (idx !== undefined) {
      targetIndices.push(CROP_IDS.length + idx);
      targetCropsList.push(mutationId);
    }
  }

  // Validate crop counts
  if (inputCropsList.length > MAX_DOUBLE_CROPS) {
    throw new Error(`Too many input crops: ${inputCropsList.length} (max ${MAX_DOUBLE_CROPS})`);
  }
  if (targetCropsList.length > MAX_DOUBLE_CROPS) {
    throw new Error(`Too many target crops: ${targetCropsList.length} (max ${MAX_DOUBLE_CROPS})`);
  }

  // Use double mode if either category exceeds single-char limit
  const useDouble = inputCropsList.length > MAX_SINGLE_CROPS || targetCropsList.length > MAX_SINGLE_CROPS;
  const emptyChar = useDouble ? ".." : ".";

  // Build grid using local indices
  const grid = new Array<string>(TOTAL_CELLS).fill(emptyChar);

  // A doubled grid uses a doubled digit for each tile, preserving its cell width.
  for (const { ground, position: [row, col] } of groundTiles) {
    const digit = GROUND_TYPES.indexOf(ground);
    if (digit < 0) throw new Error(`Unknown ground type: ${ground}`);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
      throw new Error(`Ground tile (${row},${col}) is outside the grid`);
    }
    const pos = row * GRID_SIZE + col;
    if (grid[pos] !== emptyChar) throw new Error(`Duplicate ground tile at (${row},${col})`);
    grid[pos] = String(digit).repeat(useDouble ? 2 : 1);
  }

  // Assign characters to input crops
  inputCropsList.forEach((crop, localIdx) => {
    const chars = useDouble ? indexToDouble(localIdx) : LETTERS[localIdx];
    for (const pos of inputs[crop]) {
      grid[pos] = chars;
    }
  });

  // Assign characters to target crops
  targetCropsList.forEach((mutation, localIdx) => {
    const chars = useDouble ? indexToDouble(localIdx).toUpperCase() : LETTERS[localIdx].toUpperCase();
    for (const pos of targets[mutation]) {
      grid[pos] = chars;
    }
  });

  for (const { position: [row, col] } of groundTiles) {
    const pos = row * GRID_SIZE + col;
    if (/^[a-z]+$/i.test(grid[pos])) throw new Error(`Ground tile at (${row},${col}) overlaps a plant or target`);
  }

  const inputIdx = inputIndices.map((i) => i.toString(36)).join(",");
  const targetIdx = targetIndices.map((i) => i.toString(36)).join(",");
  return inputIdx + "|" + targetIdx + "|" + grid.join("");
}

function decodeGridString(str: string): {
  inputs: GroupedPlacements;
  targets: GroupedPlacements;
  groundTiles: GroundTile[];
} {
  const parts = str.split("|");
  if (parts.length !== 3) {
    throw new Error("Invalid format: expected 3 parts separated by pipes");
  }

  const [inputIdxStr, targetIdxStr, gridStr] = parts;

  // Parse indices
  const inputIndices = inputIdxStr ? inputIdxStr.split(",").map((c) => parseInt(c, 36)) : [];
  const targetIndices = targetIdxStr ? targetIdxStr.split(",").map((c) => parseInt(c, 36)) : [];

  // Map indices to crop/mutation IDs
  const inputCrops = inputIndices.map((idx) => {
    if (idx < CROP_IDS.length) {
      return CROP_IDS[idx];
    } else {
      return MUTATION_IDS[idx - CROP_IDS.length];
    }
  }).filter(Boolean);
  
  const targetCrops = targetIndices.map((idx) => {
    // Use unified index scheme
    if (idx < CROP_IDS.length) {
      return CROP_IDS[idx];
    } else {
      return MUTATION_IDS[idx - CROP_IDS.length];
    }
  }).filter(Boolean);

  const useDouble = gridStr.length === TOTAL_CELLS * 2;
  const charWidth = useDouble ? 2 : 1;
  const expectedGridLength = TOTAL_CELLS * charWidth;

  if (gridStr.length !== expectedGridLength) {
    throw new Error(`Invalid grid: expected ${TOTAL_CELLS} or ${TOTAL_CELLS * 2} characters, got ${gridStr.length}`);
  }

  const emptyChar = useDouble ? ".." : ".";

  const inputs: GroupedPlacements = {};
  const targets: GroupedPlacements = {};
  const groundTiles: GroundTile[] = [];

  // Initialize empty arrays for each crop
  inputCrops.forEach((crop) => {
    inputs[crop] = [];
  });
  targetCrops.forEach((crop) => {
    targets[crop] = [];
  });

  // Parse grid
  for (let pos = 0; pos < TOTAL_CELLS; pos++) {
    const chars = gridStr.slice(pos * charWidth, (pos + 1) * charWidth);
    if (chars === emptyChar) continue;
    if (useDouble ? /^([0-5])\1$/.test(chars) : /^[0-5]$/.test(chars)) {
      groundTiles.push({ ground: GROUND_TYPES[Number(chars[0])], position: [Math.floor(pos / GRID_SIZE), pos % GRID_SIZE] });
      continue;
    }
    if (/\d/.test(chars)) throw new Error(`Invalid ground tile at cell ${pos}: ${chars}`);

    // All uppercase = target, all lowercase = input
    const isTarget = chars === chars.toUpperCase() && chars !== chars.toLowerCase();
    const isInput = chars === chars.toLowerCase() && chars !== chars.toUpperCase();

    if (!isTarget && !isInput) continue;

    let idx: number;
    if (useDouble) {
      idx = doubleToIndex(chars);
    } else {
      idx = LETTERS.indexOf(chars.toLowerCase());
    }

    if (idx === -1) continue;

    if (isTarget && idx < targetCrops.length) {
      targets[targetCrops[idx]].push(pos);
    } else if (isInput && idx < inputCrops.length) {
      inputs[inputCrops[idx]].push(pos);
    }
  }

  return { inputs, targets, groundTiles };
}

function ungroupPlacements(
  grouped: GroupedPlacements
): Array<{ cropId: string; position: [number, number] }> {
  const placements: Array<{ cropId: string; position: [number, number] }> = [];
  for (const [cropId, positions] of Object.entries(grouped)) {
    for (const pos of positions) {
      const row = Math.floor(pos / GRID_SIZE);
      const col = pos % GRID_SIZE;
      placements.push({ cropId, position: [row, col] });
    }
  }
  return placements;
}

export function encodeDesign(
  inputPlacements: Array<{ cropId: string; position: [number, number] }>,
  targetPlacements: Array<{ cropId: string; position: [number, number] }>,
  groundTiles: GroundTile[] = []
): string {
  // Group placements by crop
  const inputs = groupPlacements(inputPlacements);
  const targets = groupPlacements(targetPlacements);

  // Encode to grid string format
  const gridString = encodeGridString(inputs, targets, groundTiles);

  // Compress with deflate (max compression)
  const compressed = deflateRaw(gridString, { level: 9 });

  // Convert to URL-safe base64
  return toUrlSafeBase64(compressed);
}

/**
 * Pull the layout code out of whatever the user pasted: a designer URL
 * (`...designer?layout=ABC`), a share URL (`.../share/ABC`), or a raw code.
 */
export function extractLayoutCode(input: string): string {
  const trimmed = input.trim();

  // Check if it's a URL with ?layout= parameter (greenhouse.skyshards.com/designer?layout=ABC)
  if (trimmed.includes("?layout=")) {
    try {
      const url = new URL(trimmed);
      const layoutParam = url.searchParams.get("layout");
      if (layoutParam) return layoutParam;
    } catch {
      // Not a valid URL, try regex fallback
      const match = trimmed.match(/[?&]layout=([^&]+)/);
      if (match) return match[1];
    }
  }

  // Check if it's a share URL (api.skyshards.com/share/ABC)
  if (trimmed.includes("/share/")) {
    const match = trimmed.match(/\/share\/([^/?#]+)/);
    if (match) return match[1];
  }

  // Otherwise, assume it's a raw code
  return trimmed;
}

export function decodeDesign(encoded: string): {
  inputs: Array<{ cropId: string; position: [number, number] }>;
  targets: Array<{ cropId: string; position: [number, number] }>;
  groundTiles: GroundTile[];
} {
  try {
    // Decode from URL-safe base64
    const compressed = fromUrlSafeBase64(encoded);

    // Decompress
    const gridString = inflateRaw(compressed, { to: "string" });

    // Decode grid string
    const { inputs, targets, groundTiles } = decodeGridString(gridString);

    // Convert back to placement arrays
    return {
      inputs: ungroupPlacements(inputs),
      targets: ungroupPlacements(targets),
      groundTiles,
    };
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to decode design: ${err.message}`);
    }
    throw new Error("Failed to decode design: Invalid format");
  }
}

