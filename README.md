# Race Ledger (scaffold)
Local web app scaffold to track running race results by runner profile, with filters, PB charting, map heat visualization, and CSV import overwrite behavior.

## Tech stack
- Frontend: React + TypeScript + Vite (`web/`)
- Backend: Node + Express + TypeScript (`server/`)
- Storage: local JSON file (`server/data/store.json`)
- Geocoding: OpenStreetMap Nominatim (automatic, cached in JSON)

## What is scaffolded
- Multiple runner profiles (name only)
- Race CRUD basics (create + delete, update endpoint is present in API)
- Fields: race name, distance preset/custom, date, location, chip time, half split, result URL
- Table with filters (profile, distance, year, search)
- PB progression chart by distance
- Race location map heat visualization (circle intensity by count)
- CSV import with overwrite behavior

## Run locally
1. Start backend
   - `cd server`
   - `npm install`
   - `npm run dev`
2. Start frontend (new terminal)
   - `cd web`
   - `npm install`
   - `npm run dev`
3. Open `http://localhost:5173`

Backend runs on `http://localhost:4000` and frontend proxies `/api` requests to it.

## CSV import notes
Importer validates CSV headers and expects:
- `Profile`
- `Race`
- `Location`
- `Date` (YYYY-MM-DD)
- `Distance` (kilometers)
- `Chip time` (seconds, MM:SS, or HH:MM:SS)
- `Half split` (optional)
- `Link` (optional)

Distance notes:
- `21.1` is treated as `HALF_MARATHON` (21,097.5 m)
- `42.2` is treated as `MARATHON` (42,195 m)

Overwrite key is:
- `profile + date + race name + parsed distance`

## Data file
All data persists to:
- `server/data/store.json`
