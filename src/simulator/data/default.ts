import greenhouseData from "../../../public/greenhouse/data.json";
import { loadGameData } from "./load";
import type { GameData } from "./types";

let cached: GameData | null = null;

/** The bundled data.json (a verbatim copy of the backend's), validated once. */
export function defaultGameData(): GameData {
  if (!cached) cached = loadGameData(greenhouseData);
  return cached;
}
