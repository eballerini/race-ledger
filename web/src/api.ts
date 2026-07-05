import type { CsvImportSummary, Profile, RacePayload, RaceResult } from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

interface ErrorPayload {
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = (await response.json()) as ErrorPayload
      if (payload.error) {
        message = payload.error
      }
    } catch {
      // Ignore JSON parse failures for non-JSON error responses.
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export const api = {
  listProfiles(): Promise<Profile[]> {
    return request('/profiles')
  },
  createProfile(name: string): Promise<Profile> {
    return request('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  listRaces(): Promise<RaceResult[]> {
    return request('/races')
  },
  createRace(payload: RacePayload): Promise<RaceResult> {
    return request('/races', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateRace(raceId: string, payload: RacePayload): Promise<RaceResult> {
    return request(`/races/${raceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
  deleteRace(raceId: string): Promise<void> {
    return request(`/races/${raceId}`, {
      method: 'DELETE',
    })
  },
  importCsv(csvText: string): Promise<CsvImportSummary> {
    return request('/import/csv', {
      method: 'POST',
      body: JSON.stringify({ csvText }),
    })
  },
}
