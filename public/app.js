const map = L.map("map", {
  zoomControl: true,
  minZoom: 2,
}).setView([36.2, 127.8], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 12,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const AIRPORT_PRESETS = {
  icn: { code: "ICN", name: "인천국제공항", center: [37.4602, 126.4407], zoom: 9 },
  gmp: { code: "GMP", name: "김포국제공항", center: [37.5583, 126.7906], zoom: 10 },
  pus: { code: "PUS", name: "김해국제공항", center: [35.1795, 128.9382], zoom: 10 },
  cju: { code: "CJU", name: "제주국제공항", center: [33.5113, 126.4928], zoom: 10 },
};

const KOREA_AIRPORTS = [
  { code: "ICN", name: "인천국제공항", lat: 37.4602, lon: 126.4407 },
  { code: "GMP", name: "김포국제공항", lat: 37.5583, lon: 126.7906 },
  { code: "CJU", name: "제주국제공항", lat: 33.5113, lon: 126.4928 },
  { code: "PUS", name: "김해국제공항", lat: 35.1795, lon: 128.9382 },
  { code: "TAE", name: "대구국제공항", lat: 35.8941, lon: 128.6586 },
  { code: "CJJ", name: "청주국제공항", lat: 36.717, lon: 127.4991 },
  { code: "MWX", name: "무안국제공항", lat: 34.9914, lon: 126.3828 },
  { code: "RSU", name: "여수공항", lat: 34.8423, lon: 127.6169 },
  { code: "USN", name: "울산공항", lat: 35.5935, lon: 129.3526 },
  { code: "KUV", name: "군산공항", lat: 35.9038, lon: 126.6159 },
];

const KOREA_BOUNDS = {
  minLat: 32.5,
  maxLat: 39.8,
  minLon: 124,
  maxLon: 132.5,
};

const KOREA_ALIASES = [
  "korea",
  "south korea",
  "republic of korea",
  "대한민국",
  "한국",
  "남한",
];

const AIRLINE_LABELS = {
  KAL: "Korean Air",
  AAR: "Asiana Airlines",
  JJA: "Jeju Air",
  ESR: "Eastar Jet",
  TWB: "T'way Air",
  AIR: "Air Busan",
  ASV: "Air Seoul",
  KPO: "Korea Express Air",
};

const dom = {
  searchInput: document.getElementById("searchInput"),
  airlineSelect: document.getElementById("airlineSelect"),
  flightCodeInput: document.getElementById("flightCodeInput"),
  regionSelect: document.getElementById("regionSelect"),
  autoRefreshSelect: document.getElementById("autoRefreshSelect"),
  trackLengthInput: document.getElementById("trackLengthInput"),
  trackLengthLabel: document.getElementById("trackLengthLabel"),
  limitInput: document.getElementById("limitInput"),
  limitLabel: document.getElementById("limitLabel"),
  stickySelectionInput: document.getElementById("stickySelectionInput"),
  clusterInput: document.getElementById("clusterInput"),
  refreshButton: document.getElementById("refreshButton"),
  statusText: document.getElementById("statusText"),
  visibleCount: document.getElementById("visibleCount"),
  airborneCount: document.getElementById("airborneCount"),
  groundCount: document.getElementById("groundCount"),
  updatedAt: document.getElementById("updatedAt"),
  selectionState: document.getElementById("selectionState"),
  flightDetail: document.getElementById("flightDetail"),
  listCount: document.getElementById("listCount"),
  flightList: document.getElementById("flightList"),
  presetButtons: [...document.querySelectorAll(".preset-button")],
};

let allFlights = [];
let currentMarkers = [];
let trackLine = null;
let trackHaloLine = null;
let selectedFlightId = null;
let lastRenderedFlightIds = "";
let lastFetchMode = "initial";
let moveFetchTimer = null;
let suppressViewportFetch = false;
let autoRefreshTimer = null;
let activePreset = "";
let maxTrackPoints = Number(dom.trackLengthInput.value);
let pendingViewportFetch = false;
const flightTracks = new Map();

const MOVE_FETCH_DELAY_MS = 450;
const CLUSTER_GRID_PX = 44;

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value || 0);
}

function formatDate(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toLocaleString("ko-KR", { hour12: false });
}

function metersToFeet(meters) {
  if (typeof meters !== "number") return "-";
  return `${formatNumber(Math.round(meters * 3.28084))} ft`;
}

function metersPerSecondToKnots(value) {
  if (typeof value !== "number") return "-";
  return `${Math.round(value * 1.94384)} kt`;
}

function describeSource(payload) {
  if (payload.source === "airplanes-live") {
    return "Airplanes.live 위치 데이터";
  }

  if (payload.source === "aviationstack" && payload.strategy === "korea-airports") {
    return "Aviationstack 한국 공항 출발/도착 편";
  }

  if (payload.source === "aviationstack") {
    return "Aviationstack active 편";
  }

  if (payload.source === "opensky") {
    return "OpenSky 실시간 위치";
  }

  return "실시간 공급원";
}

function currentBoundsParams() {
  const bounds = map.getBounds();
  return new URLSearchParams({
    lamin: bounds.getSouth().toFixed(4),
    lomin: bounds.getWest().toFixed(4),
    lamax: bounds.getNorth().toFixed(4),
    lomax: bounds.getEast().toFixed(4),
  });
}

function isInKoreaRegion(flight) {
  return (
    typeof flight.latitude === "number" &&
    typeof flight.longitude === "number" &&
    flight.latitude >= KOREA_BOUNDS.minLat &&
    flight.latitude <= KOREA_BOUNDS.maxLat &&
    flight.longitude >= KOREA_BOUNDS.minLon &&
    flight.longitude <= KOREA_BOUNDS.maxLon
  );
}

function getAirlineCode(flight) {
  const prefix = (flight.callsign || "").trim().match(/^[A-Z]{2,3}/);
  return prefix ? prefix[0] : "";
}

function getAirlineName(code) {
  return AIRLINE_LABELS[code] || (code ? code : "미확인");
}

function matchesKeyword(flight, keyword) {
  if (!keyword) return true;

  const searchable = [
    flight.callsign || "",
    flight.origin_country || "",
    flight.icao24 || "",
    getAirlineCode(flight),
    getAirlineName(getAirlineCode(flight)),
    isInKoreaRegion(flight) ? "대한민국 한국 korea south korea republic of korea" : "",
  ]
    .join(" ")
    .toLowerCase();

  if (searchable.includes(keyword)) return true;
  return KOREA_ALIASES.includes(keyword) && isInKoreaRegion(flight);
}

function createPlaneIcon(onGround, heading = 0) {
  const rotation = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({
    className: "",
    html: `
      <div class="plane-marker ${onGround ? "grounded" : "flying"}">
        <svg viewBox="0 0 64 64" aria-hidden="true" style="transform: rotate(${rotation}deg)">
          <path d="M32 4 36.2 20.5 51.5 26c1.4.5 1.9 2.2 1 3.4l-12.8 3.6-.9 6.8 9.6 6.7c1 .7 1.1 2.2.1 3l-2.8 2.3-9.2-4.7L34 60h-4l-2.4-12.9-9.2 4.7-2.8-2.3c-1-.8-.9-2.3.1-3l9.6-6.7-.9-6.8-12.8-3.6c-.9-1.2-.4-2.9 1-3.4l15.3-5.5L32 4Z" />
        </svg>
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -14],
  });
}

function createClusterIcon(count) {
  const sizeClass = count >= 20 ? "large" : count >= 8 ? "" : "small";
  return L.divIcon({
    className: "",
    html: `<div class="cluster-marker ${sizeClass}">${count}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

function popupHtml(flight) {
  const track = flightTracks.get(flight.icao24) || [];
  return `
    <strong>${flight.callsign || flight.icao24.toUpperCase()}</strong><br />
    등록 국가: ${flight.origin_country}<br />
    항공사: ${getAirlineName(getAirlineCode(flight))}<br />
    상태: ${flight.on_ground ? "지상" : "비행 중"}<br />
    고도: ${metersToFeet(flight.geo_altitude ?? flight.baro_altitude)}<br />
    속도: ${metersPerSecondToKnots(flight.velocity)}<br />
    관측 궤적 점: ${track.length}개
  `;
}

function clearMarkers() {
  currentMarkers.forEach((marker) => marker.remove());
  currentMarkers = [];
}

function clearTrackLine() {
  if (trackHaloLine) {
    trackHaloLine.remove();
    trackHaloLine = null;
  }

  if (trackLine) {
    trackLine.remove();
    trackLine = null;
  }
}

function appendTrackPoint(flight) {
  if (typeof flight.latitude !== "number" || typeof flight.longitude !== "number") return;

  const existing = flightTracks.get(flight.icao24) || [];
  const latest = existing[existing.length - 1];
  const candidate = {
    lat: flight.latitude,
    lon: flight.longitude,
    time: flight.last_contact || Date.now() / 1000,
  };

  if (latest && latest.lat === candidate.lat && latest.lon === candidate.lon) return;
  flightTracks.set(flight.icao24, [...existing, candidate].slice(-maxTrackPoints));
}

function pruneTracks() {
  flightTracks.forEach((track, flightId) => {
    flightTracks.set(flightId, track.slice(-maxTrackPoints));
  });
}

function renderTrackLine() {
  clearTrackLine();
  if (!selectedFlightId) return;

  const track = flightTracks.get(selectedFlightId) || [];
  if (track.length < 2) return;

  const latLngs = track.map((point) => [point.lat, point.lon]);

  trackHaloLine = L.polyline(latLngs, {
    color: "#fff4a8",
    weight: 9,
    opacity: 0.22,
    lineCap: "round",
  }).addTo(map);

  trackLine = L.polyline(
    latLngs,
    {
      color: "#ffd94d",
      weight: 4,
      opacity: 0.95,
      dashArray: "14 10",
      lineCap: "round",
    }
  ).addTo(map);
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearingBetween(aLat, aLon, bLat, bLon) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLon = toRad(bLon - aLon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function headingDelta(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function nearestAirport(lat, lon) {
  let best = null;

  KOREA_AIRPORTS.forEach((airport) => {
    const distanceKm = haversineKm(lat, lon, airport.lat, airport.lon);
    if (!best || distanceKm < best.distanceKm) {
      best = { ...airport, distanceKm };
    }
  });

  return best;
}

function estimateRoute(flight) {
  const track = flightTracks.get(flight.icao24) || [];
  const firstPoint = track[0];
  const lastPoint = track[track.length - 1];

  if (!firstPoint || !lastPoint) {
    return { departure: null, arrival: inferDestinationAirport(flight) };
  }

  return {
    departure: nearestAirport(firstPoint.lat, firstPoint.lon),
    arrival: inferDestinationAirport(flight, lastPoint),
  };
}

function inferDestinationAirport(flight, fromPoint) {
  const sourcePoint = fromPoint || {
    lat: flight.latitude,
    lon: flight.longitude,
  };

  if (typeof sourcePoint.lat !== "number" || typeof sourcePoint.lon !== "number") {
    return null;
  }

  if (typeof flight.true_track !== "number") {
    return nearestAirport(sourcePoint.lat, sourcePoint.lon);
  }

  let best = null;

  KOREA_AIRPORTS.forEach((airport) => {
    const distanceKm = haversineKm(sourcePoint.lat, sourcePoint.lon, airport.lat, airport.lon);
    const bearing = bearingBetween(sourcePoint.lat, sourcePoint.lon, airport.lat, airport.lon);
    const delta = headingDelta(flight.true_track, bearing);

    if (delta > 95) return;

    const score = distanceKm + delta * 2.4;
    if (!best || score < best.score) {
      best = {
        ...airport,
        distanceKm,
        delta,
        score,
      };
    }
  });

  return best || nearestAirport(sourcePoint.lat, sourcePoint.lon);
}

function selectedFlight() {
  return allFlights.find((flight) => flight.icao24 === selectedFlightId) || null;
}

function updateDetailPanel() {
  const flight = selectedFlight();

  if (!flight) {
    dom.selectionState.textContent = "없음";
    dom.flightDetail.className = "detail-empty";
    dom.flightDetail.textContent =
      "항공기를 선택하면 상세 정보와 최근 궤적, 추정 출발/도착 공항을 보여줍니다.";
    return;
  }

  const route = estimateRoute(flight);
  const airlineCode = getAirlineCode(flight);
  const track = flightTracks.get(flight.icao24) || [];

  dom.selectionState.textContent = dom.stickySelectionInput.checked ? "고정됨" : "선택됨";
  dom.flightDetail.className = "";
  dom.flightDetail.innerHTML = `
    <h3 class="detail-title">${flight.callsign || flight.icao24.toUpperCase()}</h3>
    <p class="detail-subtitle">${getAirlineName(airlineCode)} · ${flight.origin_country}</p>
    <div class="detail-grid">
      <div class="detail-card">
        <span>현재 상태</span>
        <strong>${flight.on_ground ? "지상" : "비행 중"}</strong>
      </div>
      <div class="detail-card">
        <span>현재 고도</span>
        <strong>${metersToFeet(flight.geo_altitude ?? flight.baro_altitude)}</strong>
      </div>
      <div class="detail-card">
        <span>현재 속도</span>
        <strong>${metersPerSecondToKnots(flight.velocity)}</strong>
      </div>
      <div class="detail-card">
        <span>방향</span>
        <strong>${typeof flight.true_track === "number" ? `${Math.round(flight.true_track)}°` : "-"}</strong>
      </div>
      <div class="detail-card">
        <span>추정 출발 공항</span>
        <strong>${route.departure ? `${route.departure.code} ${route.departure.name}` : "-"}</strong>
      </div>
      <div class="detail-card">
        <span>추정 목적지</span>
        <strong>${route.arrival ? `${route.arrival.code} ${route.arrival.name}` : "-"}</strong>
      </div>
      <div class="detail-card">
        <span>최근 관측 수</span>
        <strong>${track.length}점</strong>
      </div>
      <div class="detail-card">
        <span>마지막 수신 시각</span>
        <strong>${formatDate(flight.last_contact)}</strong>
      </div>
    </div>
  `;
}

function populateAirlines(flights) {
  const currentValue = dom.airlineSelect.value;
  const codes = [...new Set(flights.map(getAirlineCode).filter(Boolean))].sort();

  dom.airlineSelect.innerHTML = '<option value="all">전체 항공사</option>';
  codes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code} · ${getAirlineName(code)}`;
    dom.airlineSelect.appendChild(option);
  });

  dom.airlineSelect.value = codes.includes(currentValue) ? currentValue : "all";
}

function filteredFlights() {
  const keyword = dom.searchInput.value.trim().toLowerCase();
  const airlineCode = dom.airlineSelect.value;
  const flightPrefix = dom.flightCodeInput.value.trim().toLowerCase();
  const region = dom.regionSelect.value;
  const limit = Number(dom.limitInput.value);

  return allFlights
    .filter((flight) => typeof flight.latitude === "number" && typeof flight.longitude === "number")
    .filter((flight) => (region === "korea" ? isInKoreaRegion(flight) : true))
    .filter((flight) => matchesKeyword(flight, keyword))
    .filter((flight) => (airlineCode === "all" ? true : getAirlineCode(flight) === airlineCode))
    .filter((flight) =>
      !flightPrefix ? true : (flight.callsign || "").trim().toLowerCase().startsWith(flightPrefix)
    )
    .sort((a, b) => {
      const selectedPriorityA = a.icao24 === selectedFlightId ? -1 : 0;
      const selectedPriorityB = b.icao24 === selectedFlightId ? -1 : 0;
      if (selectedPriorityA !== selectedPriorityB) return selectedPriorityA - selectedPriorityB;

      const koreaPriorityA = isInKoreaRegion(a) ? 0 : 1;
      const koreaPriorityB = isInKoreaRegion(b) ? 0 : 1;
      if (koreaPriorityA !== koreaPriorityB) return koreaPriorityA - koreaPriorityB;

      const groundPriorityA = a.on_ground ? 1 : 0;
      const groundPriorityB = b.on_ground ? 1 : 0;
      if (groundPriorityA !== groundPriorityB) return groundPriorityA - groundPriorityB;

      return (b.last_contact || 0) - (a.last_contact || 0);
    })
    .slice(0, limit);
}

function setSelection(flight, options = {}) {
  if (!flight) return;
  if (!dom.stickySelectionInput.checked && options.source !== "user") return;

  selectedFlightId = flight.icao24;
  appendTrackPoint(flight);

  if (options.flyTo) {
    suppressViewportFetch = true;
    map.flyTo([flight.latitude, flight.longitude], options.zoom || 6, { duration: 0.7 });
  }
}

function renderList(flights) {
  dom.flightList.innerHTML = "";
  dom.listCount.textContent = `${formatNumber(flights.length)}건`;

  flights.forEach((flight) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `flight-card ${selectedFlightId === flight.icao24 ? "active" : ""}`;
    button.innerHTML = `
      <div class="flight-card-header">
        <h3>${flight.callsign || flight.icao24.toUpperCase()}</h3>
        <strong>${getAirlineCode(flight) || "-"}</strong>
      </div>
      <p>${flight.origin_country}</p>
      <p>고도 ${metersToFeet(flight.geo_altitude ?? flight.baro_altitude)} · 속도 ${metersPerSecondToKnots(flight.velocity)}</p>
      <div class="flight-card-badges">
        <span class="badge ${flight.on_ground ? "grounded" : "flying"}">${flight.on_ground ? "지상" : "비행 중"}</span>
        ${isInKoreaRegion(flight) ? '<span class="badge korea">대한민국 주변</span>' : ""}
        ${selectedFlightId === flight.icao24 ? '<span class="badge selected">선택됨</span>' : ""}
      </div>
    `;

    button.addEventListener("click", () => {
      setSelection(flight, { flyTo: true, source: "user" });
      render();
      const marker = currentMarkers.find((item) => item.flightId === flight.icao24);
      if (marker && marker.openPopup) marker.openPopup();
    });

    dom.flightList.appendChild(button);
  });
}

function renderStats(flights) {
  const airborne = flights.filter((flight) => !flight.on_ground).length;
  const grounded = flights.filter((flight) => flight.on_ground).length;

  dom.visibleCount.textContent = formatNumber(flights.length);
  dom.airborneCount.textContent = formatNumber(airborne);
  dom.groundCount.textContent = formatNumber(grounded);
}

function clusterFlights(flights) {
  if (!dom.clusterInput.checked || map.getZoom() >= 7) {
    return flights.map((flight) => ({ type: "flight", flight }));
  }

  const buckets = new Map();

  flights.forEach((flight) => {
    if (flight.icao24 === selectedFlightId) {
      buckets.set(`selected:${flight.icao24}`, [{ type: "flight", flight }]);
      return;
    }

    const point = map.latLngToContainerPoint([flight.latitude, flight.longitude]);
    const key = `${Math.floor(point.x / CLUSTER_GRID_PX)}:${Math.floor(point.y / CLUSTER_GRID_PX)}`;
    const bucket = buckets.get(key) || [];
    bucket.push({ type: "flight", flight });
    buckets.set(key, bucket);
  });

  return [...buckets.values()].map((bucket) => {
    if (bucket.length === 1) return bucket[0];

    const center = bucket.reduce(
      (acc, item) => {
        acc.lat += item.flight.latitude;
        acc.lon += item.flight.longitude;
        return acc;
      },
      { lat: 0, lon: 0 }
    );

    return {
      type: "cluster",
      flights: bucket.map((item) => item.flight),
      latitude: center.lat / bucket.length,
      longitude: center.lon / bucket.length,
    };
  });
}

function renderMap(flights) {
  clearMarkers();
  const items = clusterFlights(flights);

  items.forEach((item) => {
    if (item.type === "cluster") {
      const marker = L.marker([item.latitude, item.longitude], {
        icon: createClusterIcon(item.flights.length),
      }).addTo(map);

      marker.on("click", () => {
        const bounds = L.latLngBounds(item.flights.map((flight) => [flight.latitude, flight.longitude]));
        suppressViewportFetch = true;
        map.fitBounds(bounds.pad(0.35));
      });

      currentMarkers.push(marker);
      return;
    }

    const flight = item.flight;
    const marker = L.marker([flight.latitude, flight.longitude], {
      icon: createPlaneIcon(flight.on_ground, flight.true_track),
    })
      .addTo(map)
      .bindPopup(popupHtml(flight));

    marker.flightId = flight.icao24;
    marker.on("click", () => {
      setSelection(flight, { source: "user" });
      renderList(flights);
      renderTrackLine();
      updateDetailPanel();
    });

    currentMarkers.push(marker);
  });

  renderTrackLine();
}

function updatePresetButtons() {
  dom.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === activePreset);
  });
}

function updateViewport(flights) {
  if (activePreset && AIRPORT_PRESETS[activePreset]) {
    const preset = AIRPORT_PRESETS[activePreset];
    pendingViewportFetch = true;
    map.flyTo(preset.center, preset.zoom, { duration: 0.7 });
    return;
  }

  if (!flights.length) {
    suppressViewportFetch = true;
    map.flyTo([25, 10], 2.2, { duration: 0.7 });
  }
}

function render() {
  const flights = filteredFlights();
  renderStats(flights);
  renderList(flights);
  renderMap(flights);
  updateDetailPanel();
  updatePresetButtons();
  updateViewport(flights);
}

function updateTracks(flights) {
  flights.forEach((flight) => appendTrackPoint(flight));
}

function syncSelectedFlight() {
  if (!selectedFlightId) return;
  const liveFlight = selectedFlight();

  if (liveFlight) {
    appendTrackPoint(liveFlight);
    return;
  }

  if (!dom.stickySelectionInput.checked) {
    selectedFlightId = null;
    clearTrackLine();
  }
}

function scheduleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  const seconds = Number(dom.autoRefreshSelect.value);
  if (!seconds) return;

  autoRefreshTimer = setInterval(() => {
    fetchFlights("auto");
  }, seconds * 1000);
}

async function fetchFlights(mode = "manual") {
  lastFetchMode = mode;
  const message =
    mode === "viewport"
      ? "현재 지도 범위 기준으로 항공기 데이터를 갱신하는 중입니다…"
      : mode === "auto"
        ? "자동 새로고침으로 최신 항공기 정보를 가져오는 중입니다…"
        : "실시간 비행 데이터를 가져오는 중입니다…";

  dom.statusText.textContent = message;
  dom.refreshButton.disabled = true;

  try {
    const response = await fetch(`/api/flights?${currentBoundsParams().toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "데이터를 불러오지 못했습니다.");
    }

    allFlights = payload.states || [];
    populateAirlines(allFlights);
    updateTracks(allFlights);
    syncSelectedFlight();
    dom.updatedAt.textContent = formatDate(payload.time);
    dom.statusText.textContent = `${describeSource(payload)} 기준으로 현재 지도 범위에서 ${formatNumber(payload.count)}대의 항공기를 불러왔습니다.`;
    render();
  } catch (error) {
    dom.statusText.textContent = `실시간 데이터 연결에 실패했습니다. ${error.message}`;
    allFlights = [];
    dom.updatedAt.textContent = "-";
    clearTrackLine();
    render();
  } finally {
    dom.refreshButton.disabled = false;
  }
}

function scheduleViewportFetch() {
  if (moveFetchTimer) clearTimeout(moveFetchTimer);
  moveFetchTimer = setTimeout(() => fetchFlights("viewport"), MOVE_FETCH_DELAY_MS);
}

dom.searchInput.addEventListener("input", render);
dom.airlineSelect.addEventListener("change", render);
dom.flightCodeInput.addEventListener("input", render);
dom.regionSelect.addEventListener("change", () => {
  activePreset = "";
  lastRenderedFlightIds = "";
  if (dom.regionSelect.value === "korea") {
    pendingViewportFetch = true;
    map.setView([36.2, 127.8], 6);
    render();
    return;
  }

  render();
  fetchFlights("viewport");
});
dom.autoRefreshSelect.addEventListener("change", scheduleAutoRefresh);
dom.trackLengthInput.addEventListener("input", () => {
  maxTrackPoints = Number(dom.trackLengthInput.value);
  dom.trackLengthLabel.textContent = `${maxTrackPoints}점`;
  pruneTracks();
  render();
  updateDetailPanel();
});
dom.limitInput.addEventListener("input", () => {
  dom.limitLabel.textContent = `${dom.limitInput.value}대`;
  render();
});
dom.stickySelectionInput.addEventListener("change", () => {
  if (!dom.stickySelectionInput.checked && !selectedFlight()) {
    selectedFlightId = null;
    clearTrackLine();
  }
  updateDetailPanel();
});
dom.clusterInput.addEventListener("change", render);
dom.refreshButton.addEventListener("click", () => fetchFlights("manual"));

dom.presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = AIRPORT_PRESETS[button.dataset.preset];
    if (!preset) return;
    activePreset = button.dataset.preset;
    dom.regionSelect.value = "korea";
    lastRenderedFlightIds = "";
    pendingViewportFetch = true;
    map.flyTo(preset.center, preset.zoom, { duration: 0.7 });
    render();
  });
});

map.on("moveend", () => {
  if (pendingViewportFetch) {
    pendingViewportFetch = false;
    fetchFlights("viewport");
    return;
  }

  if (suppressViewportFetch) {
    suppressViewportFetch = false;
    return;
  }

  activePreset = "";
  lastRenderedFlightIds = "";
  if (lastFetchMode === "initial") return;
  scheduleViewportFetch();
});

dom.limitLabel.textContent = `${dom.limitInput.value}대`;
dom.trackLengthLabel.textContent = `${dom.trackLengthInput.value}점`;
scheduleAutoRefresh();
fetchFlights();
