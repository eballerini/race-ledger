import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Request, type Response } from "express";
import Papa from "papaparse";
import { z } from "zod";
import {
  parseDistanceMetersFromText,
  parseDistancePreset,
  resolveDistanceMeters,
} from "./distance.js";
import { geocodeLocation } from "./geocoding.js";
import { readData, writeData } from "./storage.js";
import { parseTimeToSeconds } from "./time.js";
import {
  DISTANCE_PRESETS,
  type AppData,
  type CsvImportSummary,
  type DistancePreset,
  type Profile,
  type RaceResult,
} from "./types.js";

const app = express();

const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

const profileInputSchema = z.object({
  name: z.string().trim().min(1, "Profile name is required"),
});

const raceInputSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().trim().min(1),
  distancePreset: z.enum(DISTANCE_PRESETS),
  distanceMeters: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationText: z.string().trim().min(1),
  chipTimeSeconds: z.number().positive(),
  halfSplitSeconds: z.number().positive().nullable().optional(),
  resultUrl: z.string().url().nullable().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const csvImportSchema = z.object({
  csvText: z.string().min(1, "CSV text is required"),
});

app.use(
  cors({
    origin: WEB_ORIGIN,
  }),
);
app.use(express.json({ limit: "10mb" }));

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CSV_IMPORT_HEADER_LABELS = [
  "Profile",
  "Race",
  "Location",
  "Date",
  "Distance",
  "Chip time",
  "Half split",
  "Link",
] as const;

const REQUIRED_CSV_IMPORT_HEADERS = CSV_IMPORT_HEADER_LABELS.map((header) =>
  normalizeHeader(header),
);

const CSV_IMPORT_HEADER_LABEL_BY_KEY = new Map<string, string>(
  CSV_IMPORT_HEADER_LABELS.map((header) => [normalizeHeader(header), header]),
);

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function isDistancePreset(value: string): value is DistancePreset {
  return (DISTANCE_PRESETS as readonly string[]).includes(value);
}

function getField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function validateCsvHeaders(headers: string[] | undefined): string | null {
  if (!headers || headers.length === 0) {
    return `CSV headers are required. Expected exactly: ${CSV_IMPORT_HEADER_LABELS.join(", ")}.`;
  }

  const normalizedHeaders = Array.from(
    new Set(headers.map((header) => normalizeHeader(header)).filter(Boolean)),
  );
  const missingHeaders = REQUIRED_CSV_IMPORT_HEADERS.filter(
    (requiredHeader) => !normalizedHeaders.includes(requiredHeader),
  );
  const unexpectedHeaders = normalizedHeaders.filter(
    (header) => !REQUIRED_CSV_IMPORT_HEADERS.includes(header),
  );

  if (missingHeaders.length === 0 && unexpectedHeaders.length === 0) {
    return null;
  }

  const details: string[] = [];

  if (missingHeaders.length > 0) {
    const missingLabels = missingHeaders.map(
      (header) => CSV_IMPORT_HEADER_LABEL_BY_KEY.get(header) ?? header,
    );
    details.push(`missing: ${missingLabels.join(", ")}`);
  }

  if (unexpectedHeaders.length > 0) {
    details.push(`unexpected: ${unexpectedHeaders.join(", ")}`);
  }

  return `CSV headers are invalid. Expected exactly: ${CSV_IMPORT_HEADER_LABELS.join(", ")}. (${details.join("; ")})`;
}

function buildRaceKey(
  profileId: string,
  date: string,
  raceName: string,
  distanceMeters: number,
): string {
  return `${profileId}|${date}|${normalizeKey(raceName)}|${Math.round(distanceMeters)}`;
}


function toOptionalUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }
}

function ensureValidDate(rawDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    throw new Error(`Date must use YYYY-MM-DD format (received "${rawDate}")`);
  }
}

async function resolveCoordinates(
  data: AppData,
  locationText: string,
  lat?: number,
  lng?: number,
): Promise<{ lat?: number; lng?: number }> {
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    return { lat, lng };
  }

  const cacheKey = normalizeKey(locationText);
  const cached = data.geocodeCache[cacheKey];
  if (cached) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const geocoded = await geocodeLocation(locationText);
  if (!geocoded) {
    return {};
  }

  data.geocodeCache[cacheKey] = {
    lat: geocoded.lat,
    lng: geocoded.lng,
    displayName: geocoded.displayName,
    updatedAt: new Date().toISOString(),
  };

  return { lat: geocoded.lat, lng: geocoded.lng };
}

function findOrCreateProfile(data: AppData, profileName: string): Profile {
  const normalized = normalizeKey(profileName);
  const existing = data.profiles.find((profile) => normalizeKey(profile.name) === normalized);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const created: Profile = {
    id: randomUUID(),
    name: profileName.trim(),
    createdAt: now,
  };
  data.profiles.push(created);
  return created;
}

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({ status: "ok" });
});

app.get("/api/profiles", async (_request: Request, response: Response) => {
  const data = await readData();
  response.json([...data.profiles].sort((a, b) => a.name.localeCompare(b.name)));
});

app.post("/api/profiles", async (request: Request, response: Response) => {
  const parsed = profileInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile payload" });
    return;
  }

  const data = await readData();
  const profile = findOrCreateProfile(data, parsed.data.name);
  await writeData(data);
  response.status(201).json(profile);
});

app.get("/api/races", async (request: Request, response: Response) => {
  const data = await readData();

  const profileIdFilter = request.query.profileId?.toString();
  const distanceFilter = request.query.distancePreset?.toString();
  const yearFilter = request.query.year?.toString();
  const searchFilter = request.query.search?.toString().trim().toLowerCase();

  let races = data.races;

  if (profileIdFilter) {
    races = races.filter((race) => race.profileId === profileIdFilter);
  }

  if (distanceFilter && isDistancePreset(distanceFilter)) {
    races = races.filter((race) => race.distancePreset === distanceFilter);
  }

  if (yearFilter) {
    races = races.filter((race) => race.date.startsWith(`${yearFilter}-`));
  }

  if (searchFilter) {
    races = races.filter((race) => {
      const haystack = `${race.name} ${race.locationText}`.toLowerCase();
      return haystack.includes(searchFilter);
    });
  }

  const sorted = [...races].sort((left, right) => {
    if (left.date === right.date) {
      return left.chipTimeSeconds - right.chipTimeSeconds;
    }
    return right.date.localeCompare(left.date);
  });

  response.json(sorted);
});

app.post("/api/races", async (request: Request, response: Response) => {
  const parsed = raceInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid race payload" });
    return;
  }

  const data = await readData();
  const profileExists = data.profiles.some((profile) => profile.id === parsed.data.profileId);

  if (!profileExists) {
    response.status(404).json({ error: "Profile not found" });
    return;
  }

  const now = new Date().toISOString();
  const coordinates = await resolveCoordinates(data, parsed.data.locationText, parsed.data.lat, parsed.data.lng);

  const race: RaceResult = {
    id: randomUUID(),
    profileId: parsed.data.profileId,
    name: parsed.data.name.trim(),
    distancePreset: parsed.data.distancePreset,
    distanceMeters: parsed.data.distanceMeters,
    date: parsed.data.date,
    locationText: parsed.data.locationText.trim(),
    chipTimeSeconds: parsed.data.chipTimeSeconds,
    halfSplitSeconds: parsed.data.halfSplitSeconds ?? null,
    resultUrl: parsed.data.resultUrl?.trim() || null,
    createdAt: now,
    updatedAt: now,
    ...coordinates,
  };

  data.races.push(race);
  await writeData(data);
  response.status(201).json(race);
});

app.put("/api/races/:id", async (request: Request, response: Response) => {
  const parsed = raceInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid race payload" });
    return;
  }

  const data = await readData();
  const raceIndex = data.races.findIndex((race) => race.id === request.params.id);
  if (raceIndex < 0) {
    response.status(404).json({ error: "Race not found" });
    return;
  }

  const existingRace = data.races[raceIndex];
  const coordinates = await resolveCoordinates(data, parsed.data.locationText, parsed.data.lat, parsed.data.lng);
  const now = new Date().toISOString();

  data.races[raceIndex] = {
    ...existingRace,
    profileId: parsed.data.profileId,
    name: parsed.data.name.trim(),
    distancePreset: parsed.data.distancePreset,
    distanceMeters: parsed.data.distanceMeters,
    date: parsed.data.date,
    locationText: parsed.data.locationText.trim(),
    chipTimeSeconds: parsed.data.chipTimeSeconds,
    halfSplitSeconds: parsed.data.halfSplitSeconds ?? null,
    resultUrl: parsed.data.resultUrl?.trim() || null,
    updatedAt: now,
    ...coordinates,
  };

  await writeData(data);
  response.json(data.races[raceIndex]);
});

app.delete("/api/races/:id", async (request: Request, response: Response) => {
  const data = await readData();
  const raceIndex = data.races.findIndex((race) => race.id === request.params.id);

  if (raceIndex < 0) {
    response.status(404).json({ error: "Race not found" });
    return;
  }

  data.races.splice(raceIndex, 1);
  await writeData(data);
  response.status(204).send();
});

app.post("/api/import/csv", async (request: Request, response: Response) => {
  const parsed = csvImportSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid import payload" });
    return;
  }

  const csvResult = Papa.parse<Record<string, string>>(parsed.data.csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });
  const headerValidationError = validateCsvHeaders(csvResult.meta.fields);
  if (headerValidationError) {
    response.status(400).json({ error: headerValidationError });
    return;
  }

  const data = await readData();
  const raceIndexes = new Map<string, number>();
  data.races.forEach((race, index) => {
    raceIndexes.set(buildRaceKey(race.profileId, race.date, race.name, race.distanceMeters), index);
  });

  const summary: CsvImportSummary = {
    created: 0,
    overwritten: 0,
    failed: 0,
    failures: [],
  };

  for (const parseError of csvResult.errors) {
    summary.failures.push({
      row: typeof parseError.row === "number" ? parseError.row + 2 : 0,
      error: parseError.message,
    });
  }

  for (const [index, row] of csvResult.data.entries()) {
    const rowNumber = index + 2;

    try {
      const profileName = getField(row, ["profile"]);
      const raceName = getField(row, ["race"]);
      const locationText = getField(row, ["location"]);
      const date = getField(row, ["date"]);
      const distanceRaw = getField(row, ["distance"]);
      const chipTimeRaw = getField(row, ["chip_time"]);
      const halfSplitRaw = getField(row, ["half_split"]);
      const resultUrlRaw = getField(row, ["link"]);

      if (!profileName) {
        throw new Error('Missing required "profile" value');
      }
      if (!raceName) {
        throw new Error('Missing required "race" value');
      }
      if (!locationText) {
        throw new Error('Missing required "location" value');
      }
      if (!date) {
        throw new Error('Missing required "date" value');
      }
      if (!distanceRaw) {
        throw new Error('Missing required "distance" value');
      }
      if (!chipTimeRaw) {
        throw new Error('Missing required "chip time" value');
      }

      ensureValidDate(date);

      const profile = findOrCreateProfile(data, profileName);
      const distancePreset = parseDistancePreset(distanceRaw);
      const distanceFromText = parseDistanceMetersFromText(distanceRaw);
      const distanceMeters = resolveDistanceMeters(distancePreset, distanceFromText);

      if (!distanceMeters) {
        throw new Error(
          "Distance is invalid. Use kilometer values (for example 5, 10, 21.1, 42.2) or labels like Half Marathon / Marathon.",
        );
      }

      const chipTimeSeconds = parseTimeToSeconds(chipTimeRaw);
      if (!chipTimeSeconds) {
        throw new Error(
          `Chip time "${chipTimeRaw}" is invalid. Expected seconds, MM:SS or HH:MM:SS.`,
        );
      }

      let halfSplitSeconds: number | null = null;
      if (halfSplitRaw) {
        const parsedHalfSplit = parseTimeToSeconds(halfSplitRaw);
        if (!parsedHalfSplit) {
          throw new Error(
            `Half split "${halfSplitRaw}" is invalid. Expected seconds, MM:SS or HH:MM:SS.`,
          );
        }
        halfSplitSeconds = parsedHalfSplit;
      }

      const resultUrl = toOptionalUrl(resultUrlRaw);
      const coordinates = await resolveCoordinates(data, locationText);

      const now = new Date().toISOString();
      const key = buildRaceKey(profile.id, date, raceName, distanceMeters);
      const existingIndex = raceIndexes.get(key);

      if (typeof existingIndex === "number") {
        const existingRace = data.races[existingIndex];
        data.races[existingIndex] = {
          ...existingRace,
          profileId: profile.id,
          name: raceName,
          distancePreset,
          distanceMeters,
          date,
          locationText,
          chipTimeSeconds,
          halfSplitSeconds,
          resultUrl,
          updatedAt: now,
          ...coordinates,
        };
        summary.overwritten += 1;
      } else {
        data.races.push({
          id: randomUUID(),
          profileId: profile.id,
          name: raceName,
          distancePreset,
          distanceMeters,
          date,
          locationText,
          chipTimeSeconds,
          halfSplitSeconds,
          resultUrl,
          createdAt: now,
          updatedAt: now,
          ...coordinates,
        });
        raceIndexes.set(key, data.races.length - 1);
        summary.created += 1;
      }
    } catch (error) {
      summary.failures.push({
        row: rowNumber,
        error: error instanceof Error ? error.message : "Unknown import error",
      });
    }
  }

  summary.failed = summary.failures.length;
  await writeData(data);
  response.json(summary);
});

app.use((error: unknown, _request: Request, response: Response, _next: () => void) => {
  console.error("Unhandled server error", error);
  response.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Race tracker API listening on http://localhost:${PORT}`);
});
