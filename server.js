const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const DEFAULT_PORT = Number(process.env.PORT) || 3030;
const PUBLIC_DIR = path.join(__dirname, "public");
const OPENSKY_URL = "https://opensky-network.org/api/states/all";

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
    const upstreamUrl = withBounds(new URL(OPENSKY_URL), requestUrl.searchParams);
    const response = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "flight-radar-app/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      sendJson(res, response.status, {
        error: "Failed to fetch live flight data.",
        details: `OpenSky responded with ${response.status}.`,
      });
      return;
    }

    const payload = await response.json();
    const states = Array.isArray(payload.states) ? payload.states.map(normalizeState) : [];

    sendJson(res, 200, {
      time: payload.time,
      count: states.length,
      boundsApplied: upstreamUrl.searchParams.has("lamin"),
      states,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach the live flight data provider.",
      details: error.message,
    });
  }
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
