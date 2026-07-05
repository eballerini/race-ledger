import type { DistancePreset, RaceResult, StandardDistancePreset } from './types'

export const PRESET_DISTANCE_METERS: Record<StandardDistancePreset, number> = {
  '5K': 5000,
  '10K': 10000,
  HALF_MARATHON: 21097.5,
  MARATHON: 42195,
}

export const DISTANCE_LABELS: Record<DistancePreset, string> = {
  '5K': '5K',
  '10K': '10K',
  HALF_MARATHON: 'Half Marathon',
  MARATHON: 'Marathon',
  CUSTOM: 'Custom',
}

export function formatDistanceLabel(
  distancePreset: RaceResult['distancePreset'],
  distanceMeters: RaceResult['distanceMeters'],
): string {
  if (distancePreset !== 'CUSTOM') {
    return DISTANCE_LABELS[distancePreset]
  }

  if (distanceMeters >= 1000) {
    const km = distanceMeters / 1000
    return `${km.toFixed(km >= 10 ? 1 : 2)} km`
  }

  return `${distanceMeters.toFixed(0)} m`
}
