export const DISTANCE_PRESETS = [
  '5K',
  '10K',
  'HALF_MARATHON',
  'MARATHON',
  'CUSTOM',
] as const

export type DistancePreset = (typeof DISTANCE_PRESETS)[number]
export type StandardDistancePreset = Exclude<DistancePreset, 'CUSTOM'>

export interface Profile {
  id: string
  name: string
  createdAt: string
}

export interface RaceResult {
  id: string
  profileId: string
  name: string
  distancePreset: DistancePreset
  distanceMeters: number
  date: string
  locationText: string
  lat?: number
  lng?: number
  chipTimeSeconds: number
  halfSplitSeconds: number | null
  resultUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface RacePayload {
  profileId: string
  name: string
  distancePreset: DistancePreset
  distanceMeters: number
  date: string
  locationText: string
  chipTimeSeconds: number
  halfSplitSeconds: number | null
  resultUrl: string | null
}

export interface CsvImportFailure {
  row: number
  error: string
}

export interface CsvImportSummary {
  created: number
  overwritten: number
  failed: number
  failures: CsvImportFailure[]
}
