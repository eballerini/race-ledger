export function parseTimeInputToSeconds(rawValue: string): number | null {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
  }

  const parts = trimmed.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) {
    return null
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts
    if (seconds >= 60) {
      return null
    }
    return minutes * 60 + seconds
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts
    if (minutes >= 60 || seconds >= 60) {
      return null
    }
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

export function formatSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
