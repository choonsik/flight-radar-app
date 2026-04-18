const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
const { URL } = require("url");

const DEFAULT_PORT = Number(process.env.PORT) || 3030;
const PUBLIC_DIR = path.join(__dirname, "public");
const AIRPLANES_LIVE_URL = "https://api.airplanes.live/v2";
const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const AVIATIONSTACK_URL = "https://api.aviationstack.com/v1/flights";
const AVIATIONSTACK_ACCESS_KEY = process.env.AVIATIONSTACK_ACCESS_KEY || "";
const LIVE_DATA_PROVIDER = process.env.LIVE_DATA_PROVIDER || "airplanes-live";
const KOREA_AIRPORT_CODES = ["ICN", "GMP", "CJU", "PUS", "TAE", "CJJ"];
const KOREA_BOUNDS = {
  minLat: 32.5,
  maxLat: 39.8,
  minLon: 124,
  maxLon: 132.5,
};
const AIRPLANES_LIVE_MAX_RADIUS_NM = 250;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function normalizeState(state) {
  const [
    icao24,
    callsign,
    origin_country,
    time_position,
    last_contact,
    longitude,
    latitude,
    baro_altitude,
    on_ground,
    velocity,
    true_track,
    vertical_rate,
    sensors,
    geo_altitude,
    squawk,
    spi,
    position_source,
    category,
  ] = state;

  return {
    icao24,
    callsign: (callsign || "").trim(),
    origin_country,
    time_position,
    last_contact,
    longitude,
    latitude,
    baro_altitude,
    on_ground,
    velocity,
    true_track,
    vertical_rate,
    sensors,
    geo_altitude,
    squawk,
    spi,
    position_source,
    category,
  };
}

function normalizeAirplanesLiveFlight(flight, now) {
  const baroFeet = typeof flight.alt_baro === "number" ? flight.alt_baro : null;
  const geomFeet = typeof flight.alt_geom === "number" ? flight.alt_geom : null;
  const seenSeconds = typeof flight.seen === "number" ? flight.seen : null;
  const seenPosSeconds = typeof flight.seen_pos === "number" ? flight.seen_pos : null;
  const onGround = flight.alt_baro === "ground";

  return {
    icao24: (flight.hex || "").replace(/^~/, "").toLowerCase(),
    callsign: (flight.flight || flight.r || "").trim(),
    origin_country: flight.r || flight.t || "Unknown",
    time_position: seenPosSeconds !== null ? Math.floor(now - seenPosSeconds) : null,
    last_contact: seenSeconds !== null ? Math.floor(now - seenSeconds) : Math.floor(now),
    longitude: typeof flight.lon === "number" ? flight.lon : null,
    latitude: typeof flight.lat === "number" ? flight.lat : null,
    baro_altitude: baroFeet !== null ? baroFeet / 3.28084 : null,
    on_ground: onGround,
    velocity: typeof flight.gs === "number" ? flight.gs / 1.94384 : null,
    true_track: typeof flight.track === "number" ? flight.track : null,
    vertical_rate: typeof flight.baro_rate === "number" ? flight.baro_rate * 0.00508 : null,
    sensors: null,
    geo_altitude: geomFeet !== null ? geomFeet / 3.28084 : null,
    squawk: flight.squawk || null,
    spi: Boolean(flight.spi),
    position_source: 0,
    category: flight.category || null,
    registration: flight.r || null,
    aircraft_type: flight.t || null,
  };
}

function normalizeAviationStackFlight(flight) {
  const live = flight.live || {};
  const airline = flight.airline || {};
  const flightInfo = flight.flight || {};
  const aircraft = flight.aircraft || {};

  return {
    icao24: (aircraft.icao24 || aircraft.registration || flightInfo.icao || flightInfo.iata || "").toLowerCase(),
    callsign: (flightInfo.icao || flightInfo.iata || `${airline.icao || airline.iata || ""}${flightInfo.number || ""}`).trim(),
    origin_country: airline.name || airline.icao || airline.iata || "Unknown",
    time_position: live.updated ? Math.floor(new Date(live.updated).getTime() / 1000) : null,
    last_contact: live.updated ? Math.floor(new Date(live.updated).getTime() / 1000) : null,
    longitude: typeof live.longitude === "number" ? live.longitude : null,
    latitude: typeof live.latitude === "number" ? live.latitude : null,
    baro_altitude: typeof live.altitude === "number" ? live.altitude : null,
    on_ground: Boolean(live.is_ground),
    velocity: typeof live.speed_horizontal === "number" ? live.speed_horizontal / 3.6 : null,
    true_track: typeof live.direction === "number" ? live.direction : null,
    vertical_rate: typeof live.speed_vertical === "number" ? live.speed_vertical : null,
    sensors: null,
    geo_altitude: typeof live.altitude === "number" ? live.altitude : null,
    squawk: null,
    spi: false,
    position_source: 0,
    category: null,
    departure_iata: flight.departure?.iata || null,
    arrival_iata: flight.arrival?.iata || null,
    airline_name: airline.name || null,
    flight_number: flightInfo.number || null,
  };
}

function withBounds(url, searchParams) {
  const lamin = searchParams.get("lamin");
  const lomin = searchParams.get("lomin");
  const lamax = searchParams.get("lamax");
  const lomax = searchParams.get("lomax");

  if ([lamin, lomin, lamax, lomax].every((value) => value !== null && value !== "")) {
    url.searchParams.set("lamin", lamin);
    url.searchParams.set("lomin", lomin);
    url.searchParams.set("lamax", lamax);
    url.searchParams.set("lomax", lomax);
  }

  return url;
}

async function handleFlights(res, requestUrl) {
  try {
    const { payload, states, source, strategy } = await fetchProviderFlights(requestUrl);

    sendJson(res, 200, {
      time: payload.time || Math.floor(Date.now() / 1000),
      count: states.length,
      boundsApplied: hasBounds(requestUrl.searchParams),
      source,
      strategy,
      states,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach the live flight data provider.",
      details: error.message,
    });
  }
}

async function fetchProviderFlights(requestUrl) {
  if (LIVE_DATA_PROVIDER === "airplanes-live") {
    return fetchAirplanesLiveFlights(requestUrl);
  }

  if (AVIATIONSTACK_ACCESS_KEY) {
    return fetchAviationStackFlights(requestUrl);
  }

  const upstreamUrl = withBounds(new URL(OPENSKY_URL), requestUrl.searchParams);
  const payload = await fetchOpenSkyJson(upstreamUrl);
  const states = Array.isArray(payload.states) ? payload.states.map(normalizeState) : [];

  return {
    payload,
    states,
    source: "opensky",
    strategy: "bbox",
  };
}

function boundsToPointQuery(searchParams) {
  const lamin = Number(searchParams.get("lamin"));
  const lomin = Number(searchParams.get("lomin"));
  const lamax = Number(searchParams.get("lamax"));
  const lomax = Number(searchParams.get("lomax"));

  const lat = (lamin + lamax) / 2;
  const lon = (lomin + lomax) / 2;
  const latSpanNm = Math.abs(lamax - lamin) * 60;
  const lonSpanNm = Math.abs(lomax - lomin) * 60 * Math.cos((lat * Math.PI) / 180);
  const radiusNm = Math.min(
    AIRPLANES_LIVE_MAX_RADIUS_NM,
    Math.max(25, Math.ceil(Math.sqrt(latSpanNm ** 2 + lonSpanNm ** 2) / 2))
  );

  return { lat, lon, radiusNm };
}

function hasBounds(searchParams) {
  return ["lamin", "lomin", "lamax", "lomax"].every((key) => {
    const value = searchParams.get(key);
    return value !== null && value !== "";
  });
}

function isWithinBounds(flight, searchParams) {
  if (!hasBounds(searchParams)) return true;

  const lamin = Number(searchParams.get("lamin"));
  const lomin = Number(searchParams.get("lomin"));
  const lamax = Number(searchParams.get("lamax"));
  const lomax = Number(searchParams.get("lomax"));

  return (
    typeof flight.latitude === "number" &&
    typeof flight.longitude === "number" &&
    flight.latitude >= lamin &&
    flight.latitude <= lamax &&
    flight.longitude >= lomin &&
    flight.longitude <= lomax
  );
}

function looksLikeKoreaBounds(searchParams) {
  if (!hasBounds(searchParams)) return false;

  const lamin = Number(searchParams.get("lamin"));
  const lomin = Number(searchParams.get("lomin"));
  const lamax = Number(searchParams.get("lamax"));
  const lomax = Number(searchParams.get("lomax"));

  return (
    lamin >= KOREA_BOUNDS.minLat - 2 &&
    lamax <= KOREA_BOUNDS.maxLat + 2 &&
    lomin >= KOREA_BOUNDS.minLon - 4 &&
    lomax <= KOREA_BOUNDS.maxLon + 4
  );
}

function dedupeFlights(flights) {
  const uniqueFlights = new Map();

  flights.forEach((flight) => {
    const key = flight.icao24 || flight.callsign || `${flight.latitude}:${flight.longitude}`;
    const existing = uniqueFlights.get(key);

    if (!existing || (flight.last_contact || 0) > (existing.last_contact || 0)) {
      uniqueFlights.set(key, flight);
    }
  });

  return [...uniqueFlights.values()];
}

async function fetchAviationStackFlights(requestUrl) {
  const useKoreaStrategy = looksLikeKoreaBounds(requestUrl.searchParams);
  const requests = useKoreaStrategy
    ? KOREA_AIRPORT_CODES.flatMap((airportCode) => [
        { dep_iata: airportCode, flight_status: "active", limit: "100" },
        { arr_iata: airportCode, flight_status: "active", limit: "100" },
      ])
    : [{ flight_status: "active", limit: "100" }];

  const payloads = await Promise.all(
    requests.map((params) => {
      const upstreamUrl = new URL(AVIATIONSTACK_URL);
      upstreamUrl.searchParams.set("access_key", AVIATIONSTACK_ACCESS_KEY);
      Object.entries(params).forEach(([key, value]) => {
        upstreamUrl.searchParams.set(key, value);
      });
      return fetchJson(upstreamUrl, { providerName: "Aviationstack" });
    })
  );

  const rawFlights = payloads.flatMap((payload) => (Array.isArray(payload.data) ? payload.data : []));
  const states = dedupeFlights(
    rawFlights
      .map(normalizeAviationStackFlight)
      .filter((flight) => typeof flight.latitude === "number" && typeof flight.longitude === "number")
      .filter((flight) => isWithinBounds(flight, requestUrl.searchParams))
  );

  return {
    payload: {
      time: Math.floor(Date.now() / 1000),
    },
    states,
    source: "aviationstack",
    strategy: useKoreaStrategy ? "korea-airports" : "active-flights",
  };
}

async function fetchAirplanesLiveFlights(requestUrl) {
  if (!hasBounds(requestUrl.searchParams)) {
    throw new Error("Airplanes.live requires viewport bounds.");
  }

  const { lat, lon, radiusNm } = boundsToPointQuery(requestUrl.searchParams);
  const upstreamUrl = `${AIRPLANES_LIVE_URL}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;
  const payload = await fetchJson(upstreamUrl, { providerName: "Airplanes.live" });
  const now = typeof payload.now === "number" ? payload.now : Math.floor(Date.now() / 1000);
  const rawFlights = Array.isArray(payload.aircraft) ? payload.aircraft : [];
  const states = rawFlights
    .map((flight) => normalizeAirplanesLiveFlight(flight, now))
    .filter((flight) => typeof flight.latitude === "number" && typeof flight.longitude === "number")
    .filter((flight) => isWithinBounds(flight, requestUrl.searchParams));

  return {
    payload: {
      time: now,
    },
    states,
    source: "airplanes-live",
    strategy: `point-${radiusNm}nm`,
  };
}

function fetchOpenSkyJson(upstreamUrl) {
  return fetchJson(upstreamUrl, { forceIPv4: true, providerName: "OpenSky" });
}

function fetchJson(upstreamUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      upstreamUrl,
      {
        method: "GET",
        family: options.forceIPv4 ? 4 : undefined,
        lookup(hostname, lookupOptions, callback) {
          if (options.forceIPv4) {
            return dns.lookup(hostname, { ...lookupOptions, family: 4 }, callback);
          }

          return dns.lookup(hostname, lookupOptions, callback);
        },
        headers: {
          "User-Agent": "flight-radar-app/1.0",
          Accept: "application/json",
        },
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${options.providerName || "Upstream provider"} responded with ${response.statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`${options.providerName || "Upstream provider"} returned invalid JSON.`));
          }
        });
      }
    );

    req.setTimeout(12000, () => {
      req.destroy(new Error(`${options.providerName || "Upstream provider"} request timed out.`));
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (requestUrl.pathname === "/api/flights") {
    await handleFlights(res, requestUrl);
    return;
  }

  const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 400, { error: "Invalid path." });
    return;
  }

  sendFile(res, filePath);
});

function listenWithFallback(port, attemptsLeft = 10) {
  server.listen(port, () => {
    console.log(`Flight Radar app running at http://localhost:${port}`);
  });

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.warn(`Port ${port} is in use. Retrying on ${port + 1}...`);
      listenWithFallback(port + 1, attemptsLeft - 1);
      return;
    }

    throw error;
  });
}

listenWithFallback(DEFAULT_PORT);
