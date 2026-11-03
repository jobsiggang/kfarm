const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const KMA_API_BASE = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0";
const requestCounts = new Map();

function sendError(response, status, message) {
  return response.status(status).json({ error: message });
}

function normalizeServiceKey(serviceKey) {
  const trimmedKey = serviceKey.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmedKey)) return trimmedKey;
  return decodeURIComponent(trimmedKey);
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

function koreanClock(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatBaseDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function formatBaseTime(date) {
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function latestBaseTime(minute, releaseDelayMinutes) {
  const date = koreanClock(new Date(Date.now() - releaseDelayMinutes * 60_000));
  if (date.getUTCMinutes() < minute) date.setUTCHours(date.getUTCHours() - 1);
  date.setUTCMinutes(minute, 0, 0);
  return date;
}

function gridCoordinates(latitude, longitude) {
  const earthRadiusKm = 6371.00877;
  const gridSpacingKm = 5;
  const firstStandardLatitude = 30;
  const secondStandardLatitude = 60;
  const referenceLongitude = 126;
  const referenceLatitude = 38;
  const referenceX = 43;
  const referenceY = 136;
  const degreesToRadians = Math.PI / 180;
  const re = earthRadiusKm / gridSpacingKm;
  const slat1 = firstStandardLatitude * degreesToRadians;
  const slat2 = secondStandardLatitude * degreesToRadians;
  const olon = referenceLongitude * degreesToRadians;
  const olat = referenceLatitude * degreesToRadians;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2))
    / Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = Math.tan(Math.PI / 4 + slat1 / 2) ** sn * Math.cos(slat1) / sn;
  const ro = re * sf / Math.tan(Math.PI / 4 + olat / 2) ** sn;
  const ra = re * sf / Math.tan(Math.PI / 4 + latitude * degreesToRadians / 2) ** sn;
  let theta = longitude * degreesToRadians - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + referenceX + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + referenceY + 0.5),
  };
}

async function fetchKmaItems(endpoint, parameters, serviceKey, signal) {
  const url = new URL(`${KMA_API_BASE}/${endpoint}`);
  Object.entries({
    authKey: serviceKey,
    dataType: "JSON",
    numOfRows: "1000",
    pageNo: "1",
    ...parameters,
  }).forEach(([key, value]) => url.searchParams.set(key, String(value)));

  const response = await fetch(url, { signal });
  const body = await response.text();
  if (!response.ok) throw new Error(`KMA_API_ERROR:HTTP ${response.status}:${body.slice(0, 120).replace(/authKey=[^&\s]+/gi, "authKey=***")}`);
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`KMA_API_ERROR:FORMAT:${body.slice(0, 120).replace(/authKey=[^&\s]+/gi, "authKey=***")}`);
  }
  const header = result.response?.header;
  const resultCode = String(header?.resultCode ?? "").padStart(2, "0");
  if (resultCode === "03") return [];
  if (resultCode !== "00") {
    const code = String(header?.resultCode || "UNKNOWN");
    const message = String(header?.resultMsg || "an invalid response");
    throw new Error(`KMA_API_ERROR:${code}:${message}`);
  }
  const items = result.response?.body?.items?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeForecast(items) {
  const records = new Map();
  items.forEach((item) => {
    const key = `${item.fcstDate}${item.fcstTime}`;
    if (!records.has(key)) records.set(key, { time: `${item.fcstDate.slice(0, 4)}-${item.fcstDate.slice(4, 6)}-${item.fcstDate.slice(6, 8)}T${item.fcstTime.slice(0, 2)}:${item.fcstTime.slice(2, 4)}+09:00` });
    const record = records.get(key);
    record[item.category] = item.fcstValue;
  });

  return [...records.values()].sort((first, second) => first.time.localeCompare(second.time)).map((item) => {
    const precipitationType = normalizeNumber(item.PTY);
    const sky = normalizeNumber(item.SKY);
    return {
      time: item.time,
      temperature: normalizeNumber(item.TMP),
      humidity: normalizeNumber(item.REH),
      windSpeed: normalizeNumber(item.WSD),
      windDirection: normalizeNumber(item.VEC),
      precipitationProbability: normalizeNumber(item.POP),
      precipitationText: item.PCP ?? null,
      precipitationType,
      condition: precipitationType > 0
        ? ({ 1: "비", 2: "비/눈", 3: "눈", 4: "소나기" }[precipitationType] || "강수")
        : ({ 1: "맑음", 3: "구름 많음", 4: "흐림" }[sky] || "상태 자료 없음"),
    };
  });
}

function normalizeObservation(items, baseTime) {
  const values = Object.fromEntries(items.map((item) => [item.category, item.obsrValue]));
  const rain = values.RN1;
  const precipitation = rain === "강수없음" ? 0 : normalizeNumber(rain);
  const precipitationType = normalizeNumber(values.PTY);
  return {
    time: `${baseTime.toISOString().slice(0, 10)}T${formatBaseTime(baseTime)}+09:00`,
    temperature: normalizeNumber(values.T1H),
    humidity: normalizeNumber(values.REH),
    windSpeed: normalizeNumber(values.WSD),
    windDirection: normalizeNumber(values.VEC),
    precipitation,
    precipitationText: rain ?? null,
    precipitationType,
  };
}

async function fetchLatestItems(endpoint, baseTime, minute, coordinates, serviceKey, signal) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const requestTime = new Date(baseTime.getTime() - attempt * 60 * 60 * 1000);
    const items = await fetchKmaItems(endpoint, {
      base_date: formatBaseDate(requestTime),
      base_time: `${String(requestTime.getUTCHours()).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
      ...coordinates,
    }, serviceKey, signal);
    if (items.length) return { items, time: requestTime };
  }
  return { items: [], time: baseTime };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendError(response, 405, "기상청 예보는 POST 요청만 지원합니다.");
  }
  if (isRateLimited(request)) {
    return sendError(response, 429, "예보 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.");
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

  const configuredServiceKey = process.env.KMA_AUTH_KEY || process.env.KMA_SERVICE_KEY;
  const serviceKey = configuredServiceKey ? normalizeServiceKey(configuredServiceKey) : "";
  if (!serviceKey) {
    return sendError(response, 503, "기상청 단기예보 API 서비스 키가 설정되지 않았습니다.");
  }

  const { nx, ny } = gridCoordinates(latitude, longitude);
  const observationBase = latestBaseTime(0, 10);
  const forecastBase = latestBaseTime(30, 15);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const [observationResult, forecastResult] = await Promise.allSettled([
      fetchLatestItems("getUltraSrtNcst", observationBase, 0, { nx, ny }, serviceKey, controller.signal),
      fetchLatestItems("getUltraSrtFcst", forecastBase, 30, { nx, ny }, serviceKey, controller.signal),
    ]);

    if (forecastResult.status === "rejected") throw forecastResult.reason;
    const { items: forecastItems } = forecastResult.value;
    const observation = observationResult.status === "fulfilled" && observationResult.value.items.length
      ? normalizeObservation(observationResult.value.items, observationResult.value.time)
      : null;
    const forecast = normalizeForecast(forecastItems);
    if (!forecast.length) {
      return sendError(response, 502, "기상청에서 해당 위치의 실황·초단기예보를 제공하지 않습니다.");
    }

    return response.status(200).json({
      grid: { nx, ny },
      observation,
      forecast,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(response, 504, "기상청 예보 요청 시간이 초과되었습니다.");
    }
    const apiError = error.message.match(/^KMA_API_ERROR:([^:]+):(.*)$/);
    if (apiError) {
      const [, code, message] = apiError;
      if (["20", "21", "30", "31", "32", "33"].includes(code)) {
        return sendError(response, 502, `기상청 인증 오류 (${code}). 서비스 키 형식과 단기예보 API 활용 승인을 확인해 주세요.`);
      }
      console.error("KMA forecast API returned an error.", { code, message });
      return sendError(response, 502, `기상청 API 오류 (${code}): ${message.slice(0, 80)}`);
    }
    console.error("KMA forecast request failed.", error.message);
    return sendError(response, 502, "기상청 예보 서비스에 연결하지 못했습니다. 서비스 키와 API 활용 승인을 확인해 주세요.");
  } finally {
    clearTimeout(timeout);
  }
};
