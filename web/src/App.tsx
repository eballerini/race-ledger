import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from './api'
import { DISTANCE_LABELS, PRESET_DISTANCE_METERS, formatDistanceLabel } from './distance'
import { formatSeconds, parseTimeInputToSeconds } from './time'
import {
  DISTANCE_PRESETS,
  type CsvImportSummary,
  type Profile,
  type RacePayload,
  type RaceResult,
  type StandardDistancePreset,
} from './types'
import './App.css'

type AppView = 'dashboard' | 'profiles' | 'data-tools'

interface RaceFormState {
  profileId: string
  name: string
  distancePreset: (typeof DISTANCE_PRESETS)[number]
  customDistanceKm: string
  date: string
  locationText: string
  chipTime: string
  halfSplit: string
  resultUrl: string
}

const INITIAL_RACE_FORM: RaceFormState = {
  profileId: '',
  name: '',
  distancePreset: '10K',
  customDistanceKm: '',
  date: new Date().toISOString().slice(0, 10),
  locationText: '',
  chipTime: '',
  halfSplit: '',
  resultUrl: '',
}

const STANDARD_DISTANCES: StandardDistancePreset[] = [
  '5K',
  '10K',
  'HALF_MARATHON',
  'MARATHON',
]

const APP_VIEWS: Array<{ key: AppView; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'profiles', label: 'Profiles' },
  { key: 'data-tools', label: 'Data tools' },
]

interface SplitSummary {
  text: string
  trend: 'negative' | 'positive' | 'even' | null
}

function formatPacePerKm(chipTimeSeconds: number, distanceMeters: number): string {
  if (distanceMeters <= 0) {
    return '—'
  }

  const distanceKm = distanceMeters / 1000
  const paceSecondsPerKm = chipTimeSeconds / distanceKm

  if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) {
    return '—'
  }

  return `${formatSeconds(paceSecondsPerKm)} /km`
}

function getRaceDistanceGroupKey(race: Pick<RaceResult, 'distancePreset' | 'distanceMeters'>): string {
  if (race.distancePreset === 'CUSTOM') {
    return `CUSTOM:${Math.round(race.distanceMeters)}`
  }
  return race.distancePreset
}

function summarizeRaceSplit(race: RaceResult): SplitSummary {
  if (!race.halfSplitSeconds) {
    return { text: '—', trend: null }
  }

  const firstHalfSeconds = race.halfSplitSeconds
  const secondHalfSeconds = race.chipTimeSeconds - firstHalfSeconds

  if (secondHalfSeconds <= 0) {
    return {
      text: `${formatSeconds(firstHalfSeconds)} (invalid split)`,
      trend: null,
    }
  }

  const diffSeconds = Math.abs(secondHalfSeconds - firstHalfSeconds)
  if (diffSeconds === 0) {
    return {
      text: `${formatSeconds(firstHalfSeconds)} / ${formatSeconds(secondHalfSeconds)} · Even split`,
      trend: 'even',
    }
  }

  if (secondHalfSeconds < firstHalfSeconds) {
    return {
      text: `${formatSeconds(firstHalfSeconds)} / ${formatSeconds(secondHalfSeconds)} · Negative (${formatSeconds(diffSeconds)})`,
      trend: 'negative',
    }
  }

  return {
    text: `${formatSeconds(firstHalfSeconds)} / ${formatSeconds(secondHalfSeconds)} · Positive (+${formatSeconds(diffSeconds)})`,
    trend: 'positive',
  }
}

function escapeCsvCell(value: string): string {
  const safeValue = value.replaceAll('"', '""')
  if (
    safeValue.includes(',') ||
    safeValue.includes('"') ||
    safeValue.includes('\n') ||
    safeValue.includes('\r')
  ) {
    return `"${safeValue}"`
  }
  return safeValue
}

function App() {
  const [activeView, setActiveView] = useState<AppView>('dashboard')

  const [profiles, setProfiles] = useState<Profile[]>([])
  const [races, setRaces] = useState<RaceResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [newProfileName, setNewProfileName] = useState('')
  const [activeProfileId, setActiveProfileId] = useState('')
  const [raceForm, setRaceForm] = useState<RaceFormState>(INITIAL_RACE_FORM)
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null)
  const [distanceFilter, setDistanceFilter] = useState<'ALL' | (typeof DISTANCE_PRESETS)[number]>(
    'ALL',
  )
  const [yearFilter, setYearFilter] = useState('ALL')
  const [searchFilter, setSearchFilter] = useState('')

  const [pbDistance, setPbDistance] = useState<StandardDistancePreset>('10K')
  const [importSummary, setImportSummary] = useState<CsvImportSummary | null>(null)

  const profileNameById = useMemo(() => {
    return new Map(profiles.map((profile) => [profile.id, profile.name]))
  }, [profiles])

  const raceCountByProfileId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const race of races) {
      counts.set(race.profileId, (counts.get(race.profileId) ?? 0) + 1)
    }
    return counts
  }, [races])
  const activeProfileRaces = useMemo(() => {
    if (!activeProfileId) {
      return []
    }
    return races.filter((race) => race.profileId === activeProfileId)
  }, [races, activeProfileId])

  const availableYears = useMemo(() => {
    return Array.from(new Set(activeProfileRaces.map((race) => race.date.slice(0, 4))))
      .filter(Boolean)
      .sort((left, right) => Number(left) - Number(right))
  }, [activeProfileRaces])

  const filteredRaces = useMemo(() => {
    return [...activeProfileRaces]
      .filter((race) => (distanceFilter === 'ALL' ? true : race.distancePreset === distanceFilter))
      .filter((race) => (yearFilter === 'ALL' ? true : race.date.startsWith(`${yearFilter}-`)))
      .filter((race) => {
        const query = searchFilter.trim().toLowerCase()
        if (!query) {
          return true
        }
        const searchable = `${race.name} ${race.locationText}`.toLowerCase()
        return searchable.includes(query)
      })
      .sort((left, right) => {
        const dateOrder = right.date.localeCompare(left.date)
        if (dateOrder !== 0) {
          return dateOrder
        }
        return left.chipTimeSeconds - right.chipTimeSeconds
      })
  }, [activeProfileRaces, distanceFilter, yearFilter, searchFilter])

  const personalRecordRaceIds = useMemo(() => {
    const fastestByDistance = new Map<string, number>()

    for (const race of activeProfileRaces) {
      const key = getRaceDistanceGroupKey(race)
      const fastest = fastestByDistance.get(key)
      if (typeof fastest !== 'number' || race.chipTimeSeconds < fastest) {
        fastestByDistance.set(key, race.chipTimeSeconds)
      }
    }

    const raceIds = new Set<string>()
    for (const race of activeProfileRaces) {
      const key = getRaceDistanceGroupKey(race)
      if (race.chipTimeSeconds === fastestByDistance.get(key)) {
        raceIds.add(race.id)
      }
    }
    return raceIds
  }, [activeProfileRaces])

  const pbData = useMemo(() => {
    if (!activeProfileId) {
      return []
    }

    let bestSoFar = Number.POSITIVE_INFINITY

    return activeProfileRaces
      .filter((race) => race.distancePreset === pbDistance)
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((race) => {
        bestSoFar = Math.min(bestSoFar, race.chipTimeSeconds)
        return {
          date: race.date,
          pbSeconds: bestSoFar,
          raceSeconds: race.chipTimeSeconds,
        }
      })
  }, [activeProfileRaces, activeProfileId, pbDistance])

  const mapPoints = useMemo(() => {
    const buckets = new Map<
      string,
      { lat: number; lng: number; count: number; labels: Set<string> }
    >()

    for (const race of filteredRaces) {
      if (typeof race.lat !== 'number' || typeof race.lng !== 'number') {
        continue
      }

      const key = `${race.lat.toFixed(3)}:${race.lng.toFixed(3)}`
      const existing = buckets.get(key)

      if (existing) {
        existing.count += 1
        existing.labels.add(race.locationText)
      } else {
        buckets.set(key, {
          lat: race.lat,
          lng: race.lng,
          count: 1,
          labels: new Set([race.locationText]),
        })
      }
    }

    return Array.from(buckets.values()).map((point) => ({
      lat: point.lat,
      lng: point.lng,
      count: point.count,
      label: Array.from(point.labels).join(' / '),
    }))
  }, [filteredRaces])

  const activeProfileName = useMemo(() => {
    if (!activeProfileId) {
      return 'No active profile selected'
    }
    return profileNameById.get(activeProfileId) ?? 'No active profile selected'
  }, [activeProfileId, profileNameById])

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      const [nextProfiles, nextRaces] = await Promise.all([api.listProfiles(), api.listRaces()])
      setProfiles(nextProfiles)
      setRaces(nextRaces)

      if (!activeProfileId && nextProfiles.length > 0) {
        setActiveProfileId(nextProfiles[0].id)
      }

      if (!raceForm.profileId && nextProfiles.length > 0) {
        setRaceForm((current) => ({
          ...current,
          profileId: nextProfiles[0].id,
        }))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (editingRaceId) {
      return
    }
    setRaceForm((current) => {
      if (current.profileId === activeProfileId) {
        return current
      }
      return { ...current, profileId: activeProfileId }
    })
  }, [activeProfileId, editingRaceId])

  function updateRaceForm<Key extends keyof RaceFormState>(
    key: Key,
    value: RaceFormState[Key],
  ): void {
    setRaceForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleCreateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    const name = newProfileName.trim()
    if (!name) {
      setError('Profile name is required')
      return
    }

    try {
      const profile = await api.createProfile(name)
      setNewProfileName('')
      setActiveProfileId(profile.id)
      setRaceForm((current) => ({ ...current, profileId: profile.id }))
      setSuccessMessage(`Profile "${profile.name}" is ready.`)
      await loadData()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create profile')
    }
  }

  function buildRacePayload(formState: RaceFormState): RacePayload {
    if (!formState.profileId) {
      throw new Error('Select an active profile before adding a race.')
    }

    const raceName = formState.name.trim()
    if (!raceName) {
      throw new Error('Race name is required.')
    }

    const locationText = formState.locationText.trim()
    if (!locationText) {
      throw new Error('Location is required.')
    }

    const chipTimeSeconds = parseTimeInputToSeconds(formState.chipTime)
    if (!chipTimeSeconds) {
      throw new Error('Chip time must use seconds, MM:SS, or HH:MM:SS.')
    }

    let halfSplitSeconds: number | null = null
    if (formState.halfSplit.trim()) {
      halfSplitSeconds = parseTimeInputToSeconds(formState.halfSplit)
      if (!halfSplitSeconds) {
        throw new Error('Half split must use seconds, MM:SS, or HH:MM:SS.')
      }
    }

    let distanceMeters = 0
    if (formState.distancePreset === 'CUSTOM') {
      const customDistanceKm = Number(formState.customDistanceKm)
      if (!Number.isFinite(customDistanceKm) || customDistanceKm <= 0) {
        throw new Error('Custom distance must be a positive number in kilometers.')
      }
      distanceMeters = customDistanceKm * 1000
    } else {
      distanceMeters = PRESET_DISTANCE_METERS[formState.distancePreset]
    }

    return {
      profileId: formState.profileId,
      name: raceName,
      distancePreset: formState.distancePreset,
      distanceMeters,
      date: formState.date,
      locationText,
      chipTimeSeconds,
      halfSplitSeconds,
      resultUrl: formState.resultUrl.trim() || null,
    }
  }

  async function handleCreateRace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)
    const raceIdInEditMode = editingRaceId
    const profileIdForPayload = raceIdInEditMode ? raceForm.profileId : activeProfileId

    try {
      const payload = buildRacePayload({
        ...raceForm,
        profileId: profileIdForPayload,
      })

      if (raceIdInEditMode) {
        await api.updateRace(raceIdInEditMode, payload)
      } else {
        await api.createRace(payload)
      }

      setEditingRaceId(null)
      setRaceForm((current) => ({
        ...INITIAL_RACE_FORM,
        profileId: activeProfileId,
        date: current.date,
      }))
      setSuccessMessage(raceIdInEditMode ? 'Race result updated.' : 'Race result saved.')
      await loadData()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to save race result')
    }
  }

  function handleStartRaceEdit(race: RaceResult): void {
    setError(null)
    setSuccessMessage(null)
    setEditingRaceId(race.id)
    setActiveProfileId(race.profileId)
    setRaceForm({
      profileId: race.profileId,
      name: race.name,
      distancePreset: race.distancePreset,
      customDistanceKm: race.distancePreset === 'CUSTOM' ? (race.distanceMeters / 1000).toString() : '',
      date: race.date,
      locationText: race.locationText,
      chipTime: formatSeconds(race.chipTimeSeconds),
      halfSplit: race.halfSplitSeconds ? formatSeconds(race.halfSplitSeconds) : '',
      resultUrl: race.resultUrl ?? '',
    })
  }

  function handleCancelRaceEdit(): void {
    setEditingRaceId(null)
    setRaceForm((current) => ({
      ...INITIAL_RACE_FORM,
      profileId: activeProfileId,
      date: current.date,
    }))
  }

  async function handleDeleteRace(raceId: string) {
    const confirmed = window.confirm('Delete this race result?')
    if (!confirmed) {
      return
    }

    setError(null)
    setSuccessMessage(null)

    try {
      await api.deleteRace(raceId)
      setSuccessMessage('Race result deleted.')
      await loadData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete race result')
    }
  }

  async function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      return
    }

    setError(null)
    setSuccessMessage(null)

    try {
      const csvText = await selectedFile.text()
      const summary = await api.importCsv(csvText)
      setImportSummary(summary)
      setSuccessMessage(
        `CSV import complete: ${summary.created} created, ${summary.overwritten} overwritten, ${summary.failed} failed.`,
      )
      await loadData()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import CSV')
    } finally {
      event.target.value = ''
    }
  }

  function handleExportCsv(): void {
    if (races.length === 0) {
      setError('No race data available to export.')
      setSuccessMessage(null)
      return
    }

    const rows = [...races]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((race) => [
        profileNameById.get(race.profileId) ?? '',
        race.name,
        DISTANCE_LABELS[race.distancePreset],
        race.distanceMeters.toString(),
        race.date,
        race.locationText,
        formatSeconds(race.chipTimeSeconds),
        race.halfSplitSeconds ? formatSeconds(race.halfSplitSeconds) : '',
        race.resultUrl ?? '',
        typeof race.lat === 'number' ? race.lat.toString() : '',
        typeof race.lng === 'number' ? race.lng.toString() : '',
      ])

    const csvLines = [
      [
        'profile',
        'name',
        'distance',
        'distance_meters',
        'date',
        'location',
        'chip_time',
        'half_split',
        'result_url',
        'lat',
        'lng',
      ],
      ...rows,
    ]
      .map((line) => line.map((cell) => escapeCsvCell(cell)).join(','))
      .join('\n')

    const blob = new Blob([csvLines], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `race-results-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setError(null)
    setSuccessMessage(`Exported ${races.length} race results to CSV.`)
  }

  function renderDashboard() {
    return (
      <>
        <section className="card">
          <h2>{editingRaceId ? 'Edit race result' : 'Add race result'}</h2>
          <form className="form-grid" onSubmit={handleCreateRace}>
            <div className="field">
              <label htmlFor="raceName">Race name</label>
              <input
                id="raceName"
                value={raceForm.name}
                onChange={(event) => updateRaceForm('name', event.target.value)}
                placeholder="Berlin Marathon"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="distancePreset">Distance</label>
              <select
                id="distancePreset"
                value={raceForm.distancePreset}
                onChange={(event) =>
                  updateRaceForm(
                    'distancePreset',
                    event.target.value as (typeof DISTANCE_PRESETS)[number],
                  )
                }
              >
                {DISTANCE_PRESETS.map((distancePreset) => (
                  <option key={distancePreset} value={distancePreset}>
                    {DISTANCE_LABELS[distancePreset]}
                  </option>
                ))}
              </select>
            </div>
            {raceForm.distancePreset === 'CUSTOM' && (
              <div className="field">
                <label htmlFor="customDistanceKm">Custom distance (km)</label>
                <input
                  id="customDistanceKm"
                  value={raceForm.customDistanceKm}
                  onChange={(event) => updateRaceForm('customDistanceKm', event.target.value)}
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="15.0"
                  required
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="raceDate">Date</label>
              <input
                id="raceDate"
                type="date"
                value={raceForm.date}
                onChange={(event) => updateRaceForm('date', event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="raceLocation">Location</label>
              <input
                id="raceLocation"
                value={raceForm.locationText}
                onChange={(event) => updateRaceForm('locationText', event.target.value)}
                placeholder="Berlin, Germany"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="chipTime">Chip time</label>
              <input
                id="chipTime"
                value={raceForm.chipTime}
                onChange={(event) => updateRaceForm('chipTime', event.target.value)}
                placeholder="03:42:15"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="halfSplit">Half split (optional)</label>
              <input
                id="halfSplit"
                value={raceForm.halfSplit}
                onChange={(event) => updateRaceForm('halfSplit', event.target.value)}
                placeholder="01:50:20"
              />
            </div>
            <div className="field">
              <label htmlFor="resultUrl">Result URL (optional)</label>
              <input
                id="resultUrl"
                value={raceForm.resultUrl}
                onChange={(event) => updateRaceForm('resultUrl', event.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="field form-actions">
              <button className="primary" type="submit" disabled={!activeProfileId}>
                {editingRaceId ? 'Update race result' : 'Save race result'}
              </button>
              {editingRaceId && (
                <button type="button" onClick={handleCancelRaceEdit}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          {!activeProfileId && (
            <p className="helper-text" style={{ marginTop: '0.65rem' }}>
              Choose an active profile on the Profiles page before saving a race result.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Results table</h2>
          <div className="filters">
            <div className="field">
              <label htmlFor="filterDistance">Distance</label>
              <select
                id="filterDistance"
                value={distanceFilter}
                onChange={(event) =>
                  setDistanceFilter(
                    event.target.value as 'ALL' | (typeof DISTANCE_PRESETS)[number],
                  )
                }
              >
                <option value="ALL">All distances</option>
                {DISTANCE_PRESETS.map((distancePreset) => (
                  <option key={distancePreset} value={distancePreset}>
                    {DISTANCE_LABELS[distancePreset]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="filterYear">Year</label>
              <select
                id="filterYear"
                value={yearFilter}
                onChange={(event) => setYearFilter(event.target.value)}
              >
                <option value="ALL">All years</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="filterSearch">Search</label>
              <input
                id="filterSearch"
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
                placeholder="Race or location"
              />
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Race</th>
                  <th>Distance</th>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Chip time</th>
                  <th>Pace (min/km)</th>
                  <th>Half split</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRaces.map((race) => {
                  const splitSummary = summarizeRaceSplit(race)
                  const isPersonalRecord = personalRecordRaceIds.has(race.id)
                  return (
                    <tr key={race.id} className={isPersonalRecord ? 'pr-row' : undefined}>
                      <td>{race.name}</td>
                      <td>{formatDistanceLabel(race.distancePreset, race.distanceMeters)}</td>
                      <td>{race.date}</td>
                      <td>{race.locationText}</td>
                      <td>
                        {formatSeconds(race.chipTimeSeconds)}
                        {isPersonalRecord && <span className="pr-badge">PR</span>}
                      </td>
                      <td>{formatPacePerKm(race.chipTimeSeconds, race.distanceMeters)}</td>
                      <td>
                        {splitSummary.trend ? (
                          <span className={`split-chip split-chip--${splitSummary.trend}`}>
                            {splitSummary.text}
                          </span>
                        ) : (
                          splitSummary.text
                        )}
                      </td>
                      <td>
                        {race.resultUrl ? (
                          <a href={race.resultUrl} target="_blank" rel="noreferrer">
                            view
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="actions">
                        <div className="table-actions">
                          <button type="button" onClick={() => handleStartRaceEdit(race)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => void handleDeleteRace(race.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!loading && filteredRaces.length === 0 && (
            <p className="empty-state" style={{ marginTop: '0.75rem' }}>
              No races match the current filters.
            </p>
          )}
        </section>

        <section className="grid two-col">
          <section className="card">
            <h2>PB progression by distance</h2>
            <div className="field" style={{ maxWidth: '250px', marginBottom: '0.75rem' }}>
              <label htmlFor="pbDistance">Distance</label>
              <select
                id="pbDistance"
                value={pbDistance}
                onChange={(event) => setPbDistance(event.target.value as StandardDistancePreset)}
              >
                {STANDARD_DISTANCES.map((distancePreset) => (
                  <option key={distancePreset} value={distancePreset}>
                    {DISTANCE_LABELS[distancePreset]}
                  </option>
                ))}
              </select>
            </div>

            {pbData.length > 0 ? (
              <div style={{ height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={pbData} margin={{ top: 5, right: 16, bottom: 6, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(value: number) => formatSeconds(value)} />
                    <Tooltip
                      formatter={(value) => formatSeconds(Number(value ?? 0))}
                      labelFormatter={(label) => `Date: ${String(label ?? '')}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="pbSeconds"
                      name="PB"
                      stroke="#1f4ee8"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="raceSeconds"
                      name="Race"
                      stroke="#56a3ff"
                      strokeWidth={1.8}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="empty-state">No PB data available yet for this profile and distance.</p>
            )}
          </section>

          <section className="card">
            <h2>Race location heatmap</h2>
            {mapPoints.length > 0 ? (
              <div className="map-wrap">
                <MapContainer
                  center={[20, 0]}
                  zoom={2}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {mapPoints.map((point) => (
                    <CircleMarker
                      key={`${point.lat}-${point.lng}-${point.count}`}
                      center={[point.lat, point.lng]}
                      radius={Math.min(7 + point.count * 2.4, 25)}
                      pathOptions={{
                        color: '#ca2d2d',
                        fillColor: '#ff4f4f',
                        fillOpacity: Math.min(0.25 + point.count * 0.08, 0.85),
                      }}
                    >
                      <Popup>
                        <strong>{point.label}</strong>
                        <br />
                        {point.count} race{point.count > 1 ? 's' : ''}
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>
            ) : (
              <p className="empty-state">
                No mappable races in the current filter. Geocoding runs automatically on save/import.
              </p>
            )}
          </section>
        </section>
      </>
    )
  }

  function renderProfilesPage() {
    return (
      <section className="card">
        <h2>Runner profiles</h2>
        <form className="inline-form" onSubmit={handleCreateProfile}>
          <div className="field">
            <label htmlFor="profileName">Profile name</label>
            <input
              id="profileName"
              value={newProfileName}
              onChange={(event) => setNewProfileName(event.target.value)}
              placeholder="e.g. Emmanuel"
            />
          </div>
          <button className="primary" type="submit">
            Add profile
          </button>
        </form>
        <p className="helper-text">
          Active profile drives dashboard race entry, results, PB chart, and heatmap.
        </p>

        <div className="field" style={{ marginTop: '0.9rem', maxWidth: '350px' }}>
          <label htmlFor="activeProfile">Active profile</label>
          <select
            id="activeProfile"
            value={activeProfileId}
            onChange={(event) => {
              const nextId = event.target.value
              setActiveProfileId(nextId)
            }}
          >
            <option value="">Select profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Races tracked</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>{profile.name}</td>
                  <td>{raceCountByProfileId.get(profile.id) ?? 0}</td>
                  <td>{profile.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && profiles.length === 0 && (
          <p className="empty-state" style={{ marginTop: '0.75rem' }}>
            No profiles created yet.
          </p>
        )}
      </section>
    )
  }

  function renderDataToolsPage() {
    return (
      <>
        <section className="card">
          <h2>CSV import</h2>
          <p className="csv-help">
            Existing rows are overwritten by key: profile + date + race name + distance.
          </p>
          <div className="field" style={{ maxWidth: '420px' }}>
            <label htmlFor="csvUpload">Choose CSV file</label>
            <input
              id="csvUpload"
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileChange}
            />
          </div>
          <p className="helper-text">
            Required headers: Profile, Race, Location, Date, Distance, Chip time, Half split, Link.
            Distance should be in kilometers (e.g. 5, 10, 21.1, 42.2).
          </p>

          {importSummary && (
            <div style={{ marginTop: '0.85rem' }}>
              <strong>Latest import:</strong>{' '}
              {`${importSummary.created} created, ${importSummary.overwritten} overwritten, ${importSummary.failed} failed.`}
              {importSummary.failures.length > 0 && (
                <ul>
                  {importSummary.failures.slice(0, 8).map((failure) => (
                    <li key={`${failure.row}-${failure.error}`}>
                      row {failure.row}: {failure.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2>CSV export</h2>
          <p className="csv-help">
            Export includes all races and profiles currently stored in the app.
          </p>
          <button className="primary" type="button" onClick={handleExportCsv}>
            Export all race data
          </button>
          <p className="helper-text" style={{ marginTop: '0.6rem' }}>
            Current records available for export: {races.length}
          </p>
        </section>
      </>
    )
  }

  return (
    <main className="app-shell">
      <aside className="card sidebar">
        <h1>Race Result Tracker</h1>
        <p>Track runners, race results, and progression from one local app.</p>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {APP_VIEWS.map((view) => (
            <button
              key={view.key}
              className={`nav-button ${activeView === view.key ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveView(view.key)}
            >
              {view.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-meta">
          <span>Active profile</span>
          <strong>{activeProfileName}</strong>
        </div>
      </aside>

      <section className="content-area">
        {error && (
          <div className="status error" role="alert">
            {error}
          </div>
        )}
        {successMessage && <div className="status success">{successMessage}</div>}

        {loading && (
          <section className="card">
            <p>Loading data…</p>
          </section>
        )}

        <div className="page-stack">
          {activeView === 'dashboard' && renderDashboard()}
          {activeView === 'profiles' && renderProfilesPage()}
          {activeView === 'data-tools' && renderDataToolsPage()}
        </div>
      </section>
    </main>
  )
}

export default App