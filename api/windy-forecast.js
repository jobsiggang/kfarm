const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const requestCounts = new Map();
const WINDY_PARAMETERS = ["temp", "wind", "windGust", "rh", "precip", "ptype"];

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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendError(response, 405, "Windy 예보는 POST 요청만 지원합니다.");
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

  const apiKey = process.env.WINDY_POINT_FORECAST_API_KEY;
  if (!apiKey) {
    return sendError(response, 503, "Windy Point Forecast API 키가 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const windyResponse = await fetch("https://api.windy.com/api/point-forecast/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: latitude,
        lon: longitude,
        model: "gfs",
        parameters: WINDY_PARAMETERS,
        levels: ["surface"],
        key: apiKey,
      }),
      signal: controller.signal,
    });

    if (windyResponse.status !== 200) {
      console.error("Windy Point Forecast request failed with status", windyResponse.status);
      if (windyResponse.status === 204) {
        return sendError(response, 502, "Windy에서 해당 위치의 예보 자료를 제공하지 않습니다.");
      }
      if (windyResponse.status === 400) {
        return sendError(response, 502, "Windy 예보 요청을 처리하지 못했습니다. API 키 권한과 모델 설정을 확인해 주세요.");
      }
      if (windyResponse.status === 401 || windyResponse.status === 403) {
        return sendError(response, 503, "Windy API 키를 사용할 수 없습니다. Point Forecast 전용 키인지 확인해 주세요.");
      }
      return sendError(response, 502, "Windy 예보 서비스에 연결하지 못했습니다.");
    }

    const forecast = await windyResponse.json();
    if (!Array.isArray(forecast.ts) || !forecast.ts.length) {
      return sendError(response, 502, "Windy 응답에 시간별 예보 자료가 없습니다.");
    }
    return response.status(200).json({ forecast });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendError(response, 504, "Windy 예보 요청 시간이 초과되었습니다.");
    }
    console.error("Windy Point Forecast connection failed.", error);
    return sendError(response, 502, "Windy 예보 서비스에 연결하지 못했습니다.");
  } finally {
    clearTimeout(timeout);
  }
};
