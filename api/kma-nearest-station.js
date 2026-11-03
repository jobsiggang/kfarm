const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const KMA_API_BASE = "https://apis.data.go.kr/1360000";
const STATION_CACHE_MS = 6 * 60 * 60 * 1000;
const requestCounts = new Map();
let stationCache;
let stationRequest;

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function isRateLimited(request) {
  const clientIp = request.headers["x-real-ip"]
    || request.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";
  const now = Date.now();
  const current = requestCounts.get(clientIp);

  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
    return false;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return true;

  current.count += 1;
  return false;
}

function koreaDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  if (value === "강수없음") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceInKilometers(latitude, longitude, station) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(station.latitude - latitude);
  const longitudeDelta = radians(station.longitude - longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(station.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine));
}

async function fetchKmaItems(service, endpoint, parameters, serviceKey, signal) {
  const url = new URL(`${KMA_API_BASE}/${service}/${endpoint}`);
  Object.entries({
    serviceKey,
    dataType: "JSON",
    numOfRows: "1000",
    pageNo: "1",
    ...parameters,
  }).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`KMA API returned HTTP ${response.status}`);
  const result = await response.json();
  const header = result.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`KMA API returned ${header?.resultCode || "an invalid response"}`);
  }
  const items = result.response?.body?.items?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

async function loadStations(serviceKey, signal) {
  if (stationCache && Date.now() - stationCache.fetchedAt < STATION_CACHE_MS) {
    return stationCache.stations;
  }
  if (!stationRequest) {
    stationRequest = fetchKmaItems(
      "AsosInfoService",
      "getWthrStationInfo",
      {},
      serviceKey,
      signal,
    ).then((items) => {
      const koreaToday = formatDate(koreaDate());
      const stations = items.map((item) => ({
        id: String(item.stnId ?? ""),
        name: String(item.stnNm ?? ""),
        latitude: parseNumber(item.lat),
        longitude: parseNumber(item.lon),
        endDate: String(item.endDt ?? "").replaceAll("-", ""),
      })).filter((station) => station.id && station.name
        && Number.isFinite(station.latitude) && Number.isFinite(station.longitude)
        && (!station.endDate || station.endDate >= koreaToday || station.endDate === "99991231"));
      if (!stations.length) throw new Error("KMA station list was empty");
      stationCache = { stations, fetchedAt: Date.now() };
      return stations;
    }).finally(() => {
      stationRequest = null;
    });
  }
  return stationRequest;
}

function latestObservationWindow() {
  const today = koreaDate();
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 2);

  return {
    startDt: formatDate(startDate),
    startHh: "00",
    endDt: formatDate(endDate),
    endHh: "23",
  };
}

function normalizeObservation(item) {
  const time = typeof item.tm === "string" ? item.tm : "";
  const match = time.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour] = match;
  return {
    time: `${year}-${month}-${day}T${hour}:00+09:00`,
    temperature: parseNumber(item.ta),
    humidity: parseNumber(item.hm),
    windSpeed: parseNumber(item.ws),
    windDirection: parseNumber(item.wd),
    precipitation: parseNumber(item.rn),
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendError(response, 405, "가까운 관측소 조회는 POST 요청만 지원합니다.");
  }
  if (isRateLimited(request)) {
    return sendError(response, 429, "관측소 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.");
  }

  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendError(response, 400, "위치 정보를 확인할 수 없습니다.");
  }
  const { latitude, longitude } = body;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return sendError(response, 400, "위도·경도 좌표가 올바르지 않습니다.");
  }

  const serviceKey = process.env.KMA_ASOS_SERVICE_KEY || process.env.KMA_SERVICE_KEY;
  if (!serviceKey) {
    return sendError(response, 503, "기상청 ASOS 관측 API 서비스 키가 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const stations = await loadStations(serviceKey, controller.signal);
    const nearest = stations.map((station) => ({
      ...station,
      distanceKm: distanceInKilometers(latitude, longitude, station),
    })).sort((first, second) => first.distanceKm - second.distanceKm)[0];
    const items = await fetchKmaItems(
      "AsosHourlyInfoService",
      "getWthrDataList",
      {
        dataCd: "ASOS",
        dateCd: "HR",
        ...latestObservationWindow(),
        stnIds: nearest.id,
        numOfRows: "100",
      },
      serviceKey,
      controller.signal,
    );
    const observations = items.map(normalizeObservation).filter((item) => item?.time)
      .sort((first, second) => second.time.localeCompare(first.time));
    if (!observations.length) {
      return sendError(response, 502, "가장 가까운 관측소의 최신 시간자료가 없습니다. 기상청 ASOS API 활용 승인을 확인해 주세요.");
    }

    return response.status(200).json({
      station: {
        id: nearest.id,
        name: nearest.name,
        latitude: nearest.latitude,
        longitude: nearest.longitude,
        distanceKm: Math.round(nearest.distanceKm * 10) / 10,
      },
      observation: observations[0],
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(response, 504, "기상청 관측소 자료 요청 시간이 초과되었습니다.");
    }
    console.error("KMA nearest station request failed.", error.message);
    return sendError(response, 502, "가까운 기상청 관측자료를 불러오지 못했습니다. ASOS 관측소정보·시간자료 API 활용 승인을 확인해 주세요.");
  } finally {
    clearTimeout(timeout);
  }
};
