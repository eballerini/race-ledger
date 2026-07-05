import type { DistancePreset } from "./types.js";

export const PRESET_DISTANCE_METERS: Record<
  Exclude<DistancePreset, "CUSTOM">,
  number
> = {
  "5K": 5000,
  "10K": 10000,
  HALF_MARATHON: 21097.5,
  MARATHON: 42195,
};

const DISTANCE_ALIAS_MAP: Record<string, DistancePreset> = {
  "5k": "5K",
  "10k": "10K",
  "half marathon": "HALF_MARATHON",
  half: "HALF_MARATHON",
  "half_marathon": "HALF_MARATHON",
  "21k": "HALF_MARATHON",
  marathon: "MARATHON",
  "42k": "MARATHON",
  custom: "CUSTOM",
};

function parseDistanceKilometers(rawValue: string | null | undefined): number | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  const numeric = Number(normalized.replace(/[^\d.]/g, ""));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (normalized.includes("mile") || normalized.includes("mi")) {
    return null;
  }

  if (normalized.includes("meter")) {
    return null;
  }

  if (normalized.includes("km") || normalized.endsWith("k")) {
    return numeric;
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return numeric;
  }

  return null;
}

function isApproximately(value: number, expected: number, tolerance: number): boolean {
  return Math.abs(value - expected) <= tolerance;
}

export function parseDistancePreset(rawValue: string | null | undefined): DistancePreset {
  const normalized = rawValue?.trim().toLowerCase() ?? "";
  if (normalized in DISTANCE_ALIAS_MAP) {
    return DISTANCE_ALIAS_MAP[normalized];
  }

  const distanceKm = parseDistanceKilometers(rawValue);
  if (typeof distanceKm === "number") {
    if (isApproximately(distanceKm, 42.2, 0.05)) {
      return "MARATHON";
    }

    if (isApproximately(distanceKm, 21.1, 0.05)) {
      return "HALF_MARATHON";
    }

    if (isApproximately(distanceKm, 10, 0.01)) {
      return "10K";
    }

    if (isApproximately(distanceKm, 5, 0.01)) {
      return "5K";
    }
  }

  if (normalized === "5" || normalized === "5000") {
    return "5K";
  }

  if (normalized === "10" || normalized === "10000") {
    return "10K";
  }

  return "CUSTOM";
}

export function resolveDistanceMeters(
  preset: DistancePreset,
  customDistanceMeters: number | null | undefined,
): number | null {
  if (preset !== "CUSTOM") {
    return PRESET_DISTANCE_METERS[preset];
  }

  if (typeof customDistanceMeters !== "number" || !Number.isFinite(customDistanceMeters)) {
    return null;
  }

  if (customDistanceMeters <= 0) {
    return null;
  }

  return customDistanceMeters;
}

export function parseDistanceMetersFromText(rawValue: string | null | undefined): number | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  const numeric = Number(normalized.replace(/[^\d.]/g, ""));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (normalized.includes("mile") || normalized.includes("mi")) {
    return numeric * 1609.344;
  }

  if (normalized.includes("km") || normalized.endsWith("k")) {
    return numeric * 1000;
  }

  if (normalized.includes("meter") || normalized.endsWith("m")) {
    return numeric;
  }
  // For CSV import we treat plain numeric distance values as kilometers.

  return numeric * 1000;
}
