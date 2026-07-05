import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppData } from "./types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(MODULE_DIR, "..", "data");
const DATA_FILE_PATH = path.resolve(DATA_DIR, "store.json");

const DEFAULT_DATA: AppData = {
  profiles: [],
  races: [],
  geocodeCache: {},
};

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE_PATH);
  } catch {
    await fs.writeFile(DATA_FILE_PATH, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

export async function readData(): Promise<AppData> {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<AppData>;

  return {
    profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    races: Array.isArray(parsed.races) ? parsed.races : [],
    geocodeCache: parsed.geocodeCache ?? {},
  };
}

export async function writeData(data: AppData): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE_PATH, JSON.stringify(data, null, 2), "utf8");
}
