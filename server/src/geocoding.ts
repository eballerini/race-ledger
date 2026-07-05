interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

export async function geocodeLocation(locationText: string): Promise<GeocodeResult | null> {
  const query = locationText.trim();
  if (!query) {
    return null;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "race-ledger-local-app/0.1",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NominatimResult[];
    if (!Array.isArray(payload) || payload.length === 0) {
      return null;
    }

    const firstResult = payload[0];
    const lat = Number(firstResult.lat);
    const lng = Number(firstResult.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      lat,
      lng,
      displayName: firstResult.display_name,
    };
  } catch {
    return null;
  }
}
