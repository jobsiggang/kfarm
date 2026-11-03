const locations = {
  gongju: {
    name: "충청남도 공주시",
    city: "공주",
    coordinates: [36.4467, 127.119],
  },
  yesan: {
    name: "충청남도 예산군",
    city: "예산",
    coordinates: [36.6828, 126.8483],
  },
  naju: {
    name: "전라남도 나주시",
    city: "나주",
    coordinates: [35.016, 126.7108],
  },
  sangju: {
    name: "경상북도 상주시",
    city: "상주",
    coordinates: [36.4109, 128.1591],
  },
};

const toast = document.querySelector("#toast");
const weatherCache = new Map();
const weatherRequests = new Map();
const windyCache = new Map();
const windyRequests = new Map();
const kmaCache = new Map();
const kmaRequests = new Map();
const OPEN_METEO_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_CACHE_MS = 10 * 60 * 1000;
let toastTimeout;
let weatherMap;
let weatherOverlays = [];
let selectedLocationKey = "gongju";
let currentLocationWeather;
let currentPosition;
let currentLocationOverlay;
let currentLocationCircle;
let locationRequestId = 0;
let weatherRequestId = 0;
const mapMessage = document.querySelector("#map-message");
const mapLayerLabels = {
  temperature: { label: "기온", unit: "°", field: "temperature_2m" },
  wind: { label: "풍속", unit: "m/s", field: "wind_speed_10m" },
  rain: { label: "강수확률", unit: "%", field: "precipitation_probability" },
};

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "자료 없음";
}

function locationCacheKey(location) {
  return `${location.coordinates[0].toFixed(4)},${location.coordinates[1].toFixed(4)}`;
}

function parseWeatherTime(value) {
  if (typeof value === "number") return value;
  const timestamp = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? Date.parse(`${value}+09:00`)
    : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

async function fetchWeather(location, force = false) {
  const key = locationCacheKey(location);
  const cached = weatherCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) return cached.data;
  if (!force && weatherRequests.has(key)) return weatherRequests.get(key);

  const params = new URLSearchParams({
    latitude: String(location.coordinates[0]),
    longitude: String(location.coordinates[1]),
    current: [
      "temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation",
      "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
    ].join(","),
    hourly: [
      "temperature_2m", "relative_humidity_2m", "precipitation_probability", "precipitation",
      "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
      "soil_temperature_0cm", "soil_moisture_0_to_1cm", "et0_fao_evapotranspiration",
    ].join(","),
    daily: [
      "weather_code", "temperature_2m_max", "temperature_2m_min",
      "precipitation_probability_max", "precipitation_sum", "wind_speed_10m_max",
      "wind_gusts_10m_max", "sunrise", "sunset", "sunshine_duration",
    ].join(","),
    timezone: "Asia/Seoul",
    forecast_days: "7",
    wind_speed_unit: "ms",
  });
  const request = fetch(`${OPEN_METEO_API}?${params}`, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Open-Meteo 요청 실패 (${response.status})`);
      const data = await response.json();
      if (!data.current || !data.hourly?.time?.length || !data.daily?.time?.length) {
        throw new Error("Open-Meteo 응답에 필요한 예보 자료가 없습니다.");
      }
      weatherCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .finally(() => weatherRequests.delete(key));
  weatherRequests.set(key, request);
  return request;
}

async function fetchWindyForecast(location, force = false) {
  const key = locationCacheKey(location);
  const cached = windyCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) return cached.data;
  if (!force && windyRequests.has(key)) return windyRequests.get(key);

  const request = fetch("/api/windy-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: location.coordinates[0], longitude: location.coordinates[1] }),
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Windy 요청 실패 (${response.status})`);
    if (!Array.isArray(result.forecast?.ts) || !result.forecast.ts.length) {
      throw new Error("Windy 응답에 시간별 예보 자료가 없습니다.");
    }
    windyCache.set(key, { data: result.forecast, fetchedAt: Date.now() });
    return result.forecast;
  }).finally(() => windyRequests.delete(key));
  windyRequests.set(key, request);
  return request;
}

async function fetchKmaForecast(location, force = false) {
  const key = locationCacheKey(location);
  const cached = kmaCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < WEATHER_CACHE_MS) return cached.data;
  if (!force && kmaRequests.has(key)) return kmaRequests.get(key);

  const request = fetch("/api/kma-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: location.coordinates[0], longitude: location.coordinates[1] }),
  }).then(async (response) => {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `기상청 요청 실패 (${response.status})`);
    if (!Array.isArray(result.forecast) || !result.forecast.length) {
      throw new Error("기상청 응답에 시간별 예보 자료가 없습니다.");
    }
    kmaCache.set(key, { data: result, fetchedAt: Date.now() });
    return result;
  }).finally(() => kmaRequests.delete(key));
  kmaRequests.set(key, request);
  return request;
}

function weatherDescription(code) {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if ([51, 53, 55].includes(code)) return "이슬비";
  if ([56, 57].includes(code)) return "어는 이슬비";
  if ([61, 63, 65].includes(code)) return "비";
  if ([66, 67].includes(code)) return "어는 비";
  if ([71, 73, 75, 77].includes(code)) return "눈";
  if ([80, 81, 82].includes(code)) return "소나기";
  if ([85, 86].includes(code)) return "눈 소나기";
  if ([95, 96, 99].includes(code)) return "뇌우";
  return "상태 자료 없음";
}

function weatherIconClass(code, isDay = true) {
  if ([51, 53, 55, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(code)) return "mini-rain";
  if (code === 0 && !isDay) return "mini-moon";
  if (code === 0 || code === 1) return "mini-sun";
  if (code === 2) return "mini-sun-cloud";
  return "mini-cloud";
}

function formatHour(value) {
  return typeof value === "string" ? `${value.slice(11, 13)}시` : "--시";
}

function formatDate(value, options = { month: "numeric", day: "numeric", weekday: "short" }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "날짜 자료 없음"
    : new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: "Asia/Seoul" }).format(date);
}

function hourIndexNear(timeValues, targetTime) {
  const target = parseWeatherTime(targetTime);
  let closestIndex = 0;
  let closestDistance = Infinity;
  timeValues.forEach((value, index) => {
    const distance = Math.abs(parseWeatherTime(value) - target);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function todayHourlyIndices(data) {
  const today = data.current.time.slice(0, 10);
  return data.hourly.time.map((time, index) => ({ time, index }))
    .filter(({ time }) => time.slice(0, 10) === today)
    .map(({ index }) => index);
}

function sumAvailable(values, indices) {
  const usable = indices.map((index) => values?.[index]).filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) : null;
}

function windDirection(degrees) {
  if (!Number.isFinite(degrees)) return "";
  return ["북풍", "북동풍", "동풍", "남동풍", "남풍", "남서풍", "서풍", "북서풍"][Math.round(degrees / 45) % 8];
}

function setMapMessage(title, description) {
  mapMessage.querySelector("strong").textContent = title;
  mapMessage.querySelector("span").textContent = description;
  mapMessage.hidden = false;
}

function makeWeatherOverlay(locationKey, map) {
  const location = locations[locationKey];
  const element = document.createElement("button");
  element.type = "button";
  element.className = "weather-map-marker";
  element.setAttribute("aria-label", `${location.name} 기상정보`);
  element.addEventListener("click", () => {
    if (selectedLocationKey === locationKey) return;
    const selector = document.querySelector("#location-select");
    selector.value = locationKey;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const overlay = new window.kakao.maps.CustomOverlay({
    position: new window.kakao.maps.LatLng(...location.coordinates),
    content: element,
    yAnchor: 1.15,
    clickable: true,
    zIndex: locationKey === selectedLocationKey ? 3 : 1,
  });
  overlay.setMap(map);
  return { element, key: locationKey, overlay };
}

function updateWeatherMap() {
  const layer = document.querySelector("#map-layer-select").value;
  const settings = mapLayerLabels[layer] || mapLayerLabels.temperature;
  const values = Object.values(locations).flatMap((location) => {
    const forecast = weatherCache.get(locationCacheKey(location))?.data;
    const value = getMapValue(forecast, settings.field);
    return Number.isFinite(value) ? [value] : [];
  });
  const minimum = values.length ? Math.floor(Math.min(...values)) : null;
  const maximum = values.length ? Math.ceil(Math.max(...values)) : null;
  document.querySelector("#map-legend-title").textContent = settings.label;
  document.querySelector("#map-legend-range").textContent = values.length
    ? `${minimum}${settings.unit} — ${maximum}${settings.unit}`
    : "데이터 대기 중";
  if (!weatherMap || weatherOverlays.length === 0) return;

  weatherOverlays.forEach(({ element, key, overlay }) => {
    const location = locations[key];
    const forecast = weatherCache.get(locationCacheKey(location))?.data;
    const rawValue = getMapValue(forecast, settings.field);
    const value = Number.isFinite(rawValue) ? `${formatNumber(rawValue)}${settings.unit}` : "자료 없음";
    element.replaceChildren();
    const city = document.createElement("span");
    city.className = "weather-map-city";
    city.textContent = location.city;
    const weather = document.createElement("strong");
    weather.textContent = value;
    element.append(city, weather);
    element.classList.toggle("selected", key === selectedLocationKey);
    element.setAttribute("aria-label", `${location.name} ${settings.label} ${value}${settings.unit}`);
    overlay.setZIndex(key === selectedLocationKey ? 3 : 1);
  });
}

function getMapValue(forecast, field) {
  if (!forecast) return null;
  if (field === "precipitation_probability") {
    const index = hourIndexNear(forecast.hourly.time, forecast.current.time);
    return forecast.hourly.precipitation_probability[index];
  }
  return forecast.current[field];
}

function initializeWeatherMap() {
  const kakao = window.kakao;
  const mapElement = document.querySelector("#kakao-map");
  weatherMap = new kakao.maps.Map(mapElement, {
    center: currentPosition
      ? new kakao.maps.LatLng(currentPosition.latitude, currentPosition.longitude)
      : new kakao.maps.LatLng(36.05, 127.55),
    level: currentPosition ? 8 : 11,
  });
  weatherMap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  weatherOverlays = Object.keys(locations).map((key) => makeWeatherOverlay(key, weatherMap));
  updateWeatherMap();
  if (currentPosition) addCurrentLocationToMap();
  if (!currentPosition) {
    weatherMap.setBounds(
      weatherOverlays.reduce((bounds, { key }) => {
        bounds.extend(new kakao.maps.LatLng(...locations[key].coordinates));
        return bounds;
      }, new kakao.maps.LatLngBounds()),
      34,
    );
  }
  mapMessage.hidden = true;

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => weatherMap.relayout());
    resizeObserver.observe(mapElement);
  }
}

function addCurrentLocationToMap() {
  if (!weatherMap || !currentPosition) return;
  const kakao = window.kakao;
  const position = new kakao.maps.LatLng(currentPosition.latitude, currentPosition.longitude);

  if (currentLocationOverlay) currentLocationOverlay.setMap(null);
  if (currentLocationCircle) currentLocationCircle.setMap(null);

  const marker = document.createElement("div");
  marker.className = "current-location-marker";
  marker.innerHTML = '<span class="current-location-pulse"></span><strong>내 위치</strong>';
  currentLocationOverlay = new kakao.maps.CustomOverlay({
    position,
    content: marker,
    yAnchor: 1.25,
    zIndex: 5,
  });
  currentLocationOverlay.setMap(weatherMap);

  if (Number.isFinite(currentPosition.accuracy) && currentPosition.accuracy > 0) {
    currentLocationCircle = new kakao.maps.Circle({
      center: position,
      radius: Math.min(currentPosition.accuracy, 5000),
      strokeWeight: 1,
      strokeColor: "#4776e6",
      strokeOpacity: 0.7,
      strokeStyle: "solid",
      fillColor: "#4776e6",
      fillOpacity: 0.12,
    });
    currentLocationCircle.setMap(weatherMap);
  }
}

function reverseGeocode(latitude, longitude) {
  const geocoder = window.kakao?.maps?.services?.Geocoder
    ? new window.kakao.maps.services.Geocoder()
    : null;
  if (!geocoder) return Promise.resolve("");

  return new Promise((resolve) => {
    geocoder.coord2Address(longitude, latitude, (result, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !result?.[0]) {
        resolve("");
        return;
      }
      const address = result[0].road_address?.address_name || result[0].address?.address_name;
      resolve(address || "");
    });
  });
}

function formatCoordinates(latitude, longitude) {
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

async function setCurrentLocation(position, requestId) {
  const { latitude, longitude, accuracy } = position.coords;
  const address = await reverseGeocode(latitude, longitude);
  if (requestId !== locationRequestId) return;

  const placeName = address || `위치 ${formatCoordinates(latitude, longitude)}`;
  currentPosition = { latitude, longitude, accuracy };
  currentLocationWeather = {
    name: `내 위치 · ${placeName}`,
    displayName: `내 위치 · ${placeName}`,
    city: "내 위치",
    coordinates: [latitude, longitude],
  };
  document.querySelector("#location-status").textContent = `내 위치 · ${placeName}`;

  let currentOption = document.querySelector("#current-location-option");
  if (!currentOption) {
    currentOption = document.createElement("option");
    currentOption.id = "current-location-option";
    currentOption.value = "__current__";
    document.querySelector("#location-select").append(currentOption);
  }
  currentOption.textContent = currentLocationWeather.displayName;
  const selector = document.querySelector("#location-select");
  selector.value = "__current__";
  selector.dispatchEvent(new Event("change", { bubbles: true }));
  addCurrentLocationToMap();

  const accuracyText = Number.isFinite(accuracy) ? ` (정확도 약 ${Math.round(accuracy)}m)` : "";
  showToast(`${placeName}${accuracyText}. 현재 좌표의 Open-Meteo 예보를 불러옵니다.`);
}

function handleLocationError(error, silent = false) {
  let message;
  if (error.code === 1) {
    message = "위치 권한이 거부되었습니다. 브라우저 사이트 설정에서 위치 접근을 허용해 주세요.";
  } else if (error.code === 2) {
    message = "현재 위치를 확인할 수 없습니다. 기기의 위치 서비스와 네트워크를 확인해 주세요.";
  } else if (error.code === 3) {
    message = "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.";
  } else {
    message = "현재 위치를 가져오지 못했습니다. 브라우저의 위치 설정을 확인해 주세요.";
  }
  document.querySelector("#location-status").textContent = "내 위치 버튼을 눌러 위치를 설정하세요";
  if (!silent) showToast(message);
}

function requestCurrentLocation({ silent = false } = {}) {
  if (!navigator.geolocation) {
    document.querySelector("#location-status").textContent = "이 브라우저는 위치 기능을 지원하지 않습니다";
    if (!silent) showToast("이 브라우저는 위치 기능을 지원하지 않습니다.");
    return;
  }
  if (!window.isSecureContext && location.hostname !== "localhost") {
    document.querySelector("#location-status").textContent = "HTTPS 연결에서 위치 기능을 사용할 수 있습니다";
    if (!silent) showToast("현재 위치 기능은 HTTPS 환경에서 사용할 수 있습니다.");
    return;
  }

  const button = document.querySelector("#my-location-button");
  const label = button.querySelector("span");
  const originalLabel = label.textContent;
  const requestId = ++locationRequestId;
  document.querySelector("#location-status").textContent = "현재 위치를 확인하고 있습니다";
  button.disabled = true;
  label.textContent = "위치 확인 중";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCurrentLocation(position, requestId)
        .catch((error) => {
          console.error("현재 위치를 지도에 반영하지 못했습니다.", error);
          showToast("현재 위치를 지도에 반영하지 못했습니다. 다시 시도해 주세요.");
        })
        .finally(() => {
          if (requestId !== locationRequestId) return;
          button.disabled = false;
          label.textContent = originalLabel;
        });
    },
    (error) => {
      if (requestId !== locationRequestId) return;
      handleLocationError(error, silent);
      button.disabled = false;
      label.textContent = originalLabel;
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
}

function loadKakaoMap() {
  const appKey = String(window.KAKAO_MAP_APP_KEY || "").trim();
  if (!appKey) {
    setMapMessage("카카오맵 키 설정이 필요합니다", "config.js의 KAKAO_MAP_APP_KEY에 JavaScript 키를 넣고, 카카오 개발자 콘솔에 배포 도메인을 등록하세요.");
    return;
  }

  setMapMessage("카카오맵 연결 중", "지도와 실제 Open-Meteo 예보를 불러오고 있습니다.");
  let initialized = false;
  const loadTimeout = window.setTimeout(() => {
    if (!initialized) {
      setMapMessage("카카오맵을 불러오지 못했습니다", "JavaScript 키와 카카오 개발자 콘솔의 허용 도메인 설정을 확인한 뒤 새로고침해 주세요.");
    }
  }, 10000);
  const script = document.createElement("script");
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
  script.async = true;
  script.onload = () => {
    if (!window.kakao?.maps?.load) {
      window.clearTimeout(loadTimeout);
      setMapMessage("카카오맵 SDK를 사용할 수 없습니다", "JavaScript 키와 허용 도메인 설정을 확인해 주세요.");
      return;
    }
    window.kakao.maps.load(() => {
      try {
        initializeWeatherMap();
        initialized = true;
        window.clearTimeout(loadTimeout);
      } catch (error) {
        window.clearTimeout(loadTimeout);
        console.error("카카오맵 초기화에 실패했습니다.", error);
        setMapMessage("카카오맵 초기화 실패", "브라우저 콘솔에서 오류를 확인하고 카카오 키의 도메인 설정을 점검해 주세요.");
      }
    });
  };
  script.onerror = () => {
    window.clearTimeout(loadTimeout);
    console.error("카카오맵 SDK를 불러오지 못했습니다.");
    setMapMessage("카카오맵 SDK 로드 실패", "네트워크 상태와 JavaScript 키, 허용 도메인 설정을 확인해 주세요.");
  };
  document.head.append(script);
}

function renderHourlyForecast(data) {
  const { hourly } = data;
  const start = hourIndexNear(hourly.time, data.current.time);
  const indices = hourly.time.map((_, index) => index).slice(start, start + 18);
  const temperatures = indices.map((index) => hourly.temperature_2m[index]).filter(Number.isFinite);
  if (!temperatures.length) throw new Error("시간별 기온 예보 자료가 없습니다.");

  const low = Math.floor(Math.min(...temperatures));
  const high = Math.ceil(Math.max(...temperatures));
  const padding = Math.max((high - low) * 0.12, 1);
  const chartLow = low - padding;
  const chartHigh = high + padding;
  const points = indices.flatMap((index, pointIndex) => {
    const value = hourly.temperature_2m[index];
    return Number.isFinite(value)
      ? [{ x: pointIndex * 500 / Math.max(indices.length - 1, 1), y: 124 - (value - chartLow) / (chartHigh - chartLow) * 108, value, index }]
      : [];
  });
  const temperaturePath = points.map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaPath = points.length
    ? `${temperaturePath} L${points[points.length - 1].x.toFixed(1)} 130 L${points[0].x.toFixed(1)} 130 Z`
    : "";
  const rainPoints = indices.flatMap((index, pointIndex) => {
    const value = hourly.precipitation_probability[index];
    return Number.isFinite(value)
      ? [{ x: pointIndex * 500 / Math.max(indices.length - 1, 1), y: 124 - Math.max(0, Math.min(value, 100)) * 0.55 }]
      : [];
  });
  const rainPath = rainPoints.map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  document.querySelector(".chart-area").setAttribute("d", areaPath);
  document.querySelector(".chart-temp-line").setAttribute("d", temperaturePath);
  document.querySelector(".chart-rain-line").setAttribute("d", rainPath);
  document.querySelector(".chart-current-point").setAttribute("cx", points[0].x);
  document.querySelector(".chart-current-point").setAttribute("cy", points[0].y);
  document.querySelector(".chart-current-label").textContent = `${formatNumber(points[0].value, 1)}°`;
  document.querySelector(".chart-y-labels").replaceChildren(...[0, 1, 2, 3].map((step) => {
    const label = document.createElement("span");
    label.textContent = `${formatNumber(chartHigh - step * (chartHigh - chartLow) / 3, 0)}°`;
    return label;
  }));
  const labelIndices = [0, 3, 6, 9, 12, 15].filter((index) => indices[index] !== undefined);
  document.querySelector(".chart-time-labels").replaceChildren(...labelIndices.map((index) => {
    const label = document.createElement("span");
    label.textContent = formatHour(hourly.time[indices[index]]);
    return label;
  }));
  document.querySelector(".hourly-conditions").replaceChildren(...labelIndices.map((pointIndex) => {
    const index = indices[pointIndex];
    const item = document.createElement("div");
    if (pointIndex === 0) item.className = "hour-now";
    const time = document.createElement("span");
    time.textContent = formatHour(hourly.time[index]);
    const icon = document.createElement("i");
    icon.className = weatherIconClass(hourly.weather_code[index]);
    const temperature = document.createElement("strong");
    temperature.textContent = `${formatNumber(hourly.temperature_2m[index], 0)}°`;
    const rain = document.createElement("small");
    rain.textContent = Number.isFinite(hourly.precipitation_probability[index])
      ? `${formatNumber(hourly.precipitation_probability[index], 0)}%`
      : "--";
    item.append(time, icon, temperature, rain);
    return item;
  }));
}

function renderWeeklyForecast(location, data) {
  const { daily } = data;
  document.querySelector(".weekly-location").textContent = `${location.displayName || location.name} · Open-Meteo`;
  document.querySelector(".week-list").replaceChildren(...daily.time.map((date, index) => {
    const day = document.createElement("div");
    day.className = "week-day";
    const dayName = document.createElement("span");
    dayName.className = "day-name";
    dayName.textContent = index === 0 ? "오늘" : formatDate(`${date}T12:00:00+09:00`, { weekday: "short" });
    const smallDate = document.createElement("small");
    smallDate.textContent = formatDate(`${date}T12:00:00+09:00`, { month: "numeric", day: "numeric" });
    dayName.append(smallDate);
    const icon = document.createElement("i");
    icon.className = weatherIconClass(daily.weather_code[index]);
    const condition = document.createElement("span");
    condition.className = "week-condition";
    condition.textContent = weatherDescription(daily.weather_code[index]);
    const rain = document.createElement("span");
    rain.className = "week-rain";
    rain.textContent = Number.isFinite(daily.precipitation_probability_max[index])
      ? `${formatNumber(daily.precipitation_probability_max[index], 0)}%`
      : "--";
    const temperature = document.createElement("strong");
    temperature.textContent = `${formatNumber(daily.temperature_2m_max[index], 0)}°`;
    const low = document.createElement("span");
    low.textContent = `${formatNumber(daily.temperature_2m_min[index], 0)}°`;
    temperature.append(low);
    day.append(dayName, icon, condition, rain, temperature);
    return day;
  }));
}

function setWorkCard(index, status, description, values) {
  const card = document.querySelectorAll(".work-card")[index];
  card.querySelector(".work-status").textContent = status;
  card.querySelector("p").textContent = description;
  card.querySelectorAll(".work-reason strong").forEach((value, valueIndex) => {
    value.textContent = values[valueIndex];
  });
}

function renderFarmWeather(data) {
  const { current, hourly, daily } = data;
  const indices = todayHourlyIndices(data);
  const index = hourIndexNear(hourly.time, current.time);
  const rainProbability = hourly.precipitation_probability[index];
  const dailyEt0 = sumAvailable(hourly.et0_fao_evapotranspiration, indices);
  const surfaceTemperature = hourly.soil_temperature_0cm[index];
  const soilMoisture = hourly.soil_moisture_0_to_1cm[index];
  const gust = daily.wind_gusts_10m_max[0];

  document.querySelector("#farm-data-source").textContent = "Open-Meteo 모델 예보";
  setWorkCard(0, "제품 기준 확인", "예보 수치입니다. 농약 제품 라벨의 풍속·강수 제한을 확인하세요.", [
    `${formatNumber(current.wind_speed_10m)} m/s`,
    Number.isFinite(rainProbability) ? `${formatNumber(rainProbability, 0)}%` : "자료 없음",
  ]);
  setWorkCard(1, "토양 상태 확인", "예상 강수·기준 증발산량은 참고값이며 토양 센서 관측값이 아닙니다.", [
    `${formatNumber(daily.precipitation_sum[0])} mm`,
    `${formatNumber(dailyEt0)} mm`,
  ]);
  setWorkCard(2, "작물 기준 확인", "작물별 지온 기준은 제공하지 않습니다. 재배지 지온과 작물 기준을 확인하세요.", [
    `${formatNumber(current.temperature_2m)}°C`,
    `${formatNumber(surfaceTemperature)}°C`,
  ]);
  setWorkCard(3, "현장 상태 확인", "예상 강수·일조 시간입니다. 수확 전 작물과 포장 상태를 직접 확인하세요.", [
    `${formatNumber(daily.precipitation_sum[0])} mm`,
    `${formatNumber(daily.sunshine_duration[0] / 3600)} 시간`,
  ]);
  if (Number.isFinite(soilMoisture)) {
    document.querySelectorAll(".work-card")[1].querySelector("p").textContent +=
      ` 표층 토양수분 모델값 ${formatNumber(soilMoisture * 100, 0)}%.`;
  }

  const direction = windDirection(current.wind_direction_10m);
  document.querySelector("#insight-title").textContent = `${weatherDescription(current.weather_code)} · ${formatNumber(current.temperature_2m)}°C`;
  document.querySelector("#insight-description").textContent =
    `오늘 예상 강수 ${formatNumber(daily.precipitation_sum[0])} mm, 현재 습도 ${formatNumber(current.relative_humidity_2m, 0)}%${direction ? `, ${direction}` : ""}. 모델 예보이며 현장 관측은 아닙니다.`;
  document.querySelector("#insight-max-gust").textContent = `${formatNumber(gust)} m/s`;
}

function renderMetrics(data) {
  const { daily } = data;
  document.querySelector("#metric-max-temperature").innerHTML = `${formatNumber(daily.temperature_2m_max[0])}<span>°C</span>`;
  document.querySelector("#metric-temperature-note").textContent = `오늘 최저 ${formatNumber(daily.temperature_2m_min[0])}°C · Open-Meteo 예보`;
  document.querySelector("#metric-max-wind").innerHTML = `${formatNumber(daily.wind_gusts_10m_max[0])}<span>m/s</span>`;
  document.querySelector("#metric-wind-note").textContent = `평균풍속 최고 ${formatNumber(daily.wind_speed_10m_max[0])} m/s`;
  document.querySelector("#metric-rainfall").innerHTML = `${formatNumber(daily.precipitation_sum[0])}<span>mm</span>`;
  document.querySelector("#metric-rain-note").textContent = `강수확률 최고 ${formatNumber(daily.precipitation_probability_max[0], 0)}%`;
  document.querySelector("#metric-sunshine").innerHTML = `${formatNumber(daily.sunshine_duration[0] / 3600)}<span>시간</span>`;
  document.querySelector("#metric-sunshine-note").textContent = "Open-Meteo 일조시간 예보";
  document.querySelector("#sunrise-time").textContent = `일출 ${daily.sunrise[0]?.slice(11, 16) || "--:--"}`;
  document.querySelector("#sunset-time").textContent = `일몰 ${daily.sunset[0]?.slice(11, 16) || "--:--"}`;
}

function nearestKmaForecast(kma, targetTime) {
  if (!kma?.forecast?.length) return null;
  const index = hourIndexNear(kma.forecast.map((item) => item.time), targetTime);
  return kma.forecast[index];
}

function renderProviderComparison(data, kma, windyForecast) {
  const { current, hourly } = data;
  const kmaValue = nearestKmaForecast(kma, current.time);
  const comparisonTime = kmaValue?.time || current.time;
  const openMeteoIndex = hourIndexNear(hourly.time, comparisonTime);
  const rainProbability = hourly.precipitation_probability[openMeteoIndex];
  const windy = getWindyCurrent(windyForecast, comparisonTime);
  const openMeteo = {
    temperature: hourly.temperature_2m[openMeteoIndex],
    wind: hourly.wind_speed_10m[openMeteoIndex],
    humidity: hourly.relative_humidity_2m[openMeteoIndex],
    rainProbability,
    precipitation: hourly.precipitation[openMeteoIndex],
  };
  const kmaFields = {
    temperature: kmaValue?.temperature,
    wind: kmaValue?.windSpeed,
    humidity: kmaValue?.humidity,
    rainProbability: kmaValue?.precipitationProbability,
  };
  const windyFields = {
    temperature: windy?.temperature,
    wind: windy?.windSpeed,
    humidity: windy?.humidity,
  };
  const formatRow = (field, value) => {
    if (!Number.isFinite(value)) return "자료 없음";
    if (field === "temperature") return `${formatNumber(value)}°C`;
    if (field === "wind") return `${formatNumber(value)} m/s`;
    if (field === "humidity" || field === "rainProbability") return `${formatNumber(value, 0)}%`;
    return `${formatNumber(value)} mm`;
  };
  document.querySelectorAll(".comparison-table tbody tr[data-weather]").forEach((row) => {
    const field = row.dataset.weather;
    row.children[1].textContent = !kma
      ? "미연결"
      : field === "precipitation"
        ? kmaValue?.precipitationText || "자료 없음"
        : formatRow(field, kmaFields[field]);
    row.children[2].textContent = !windyForecast
      ? "미연결"
      : field === "rainProbability"
        ? "미지원"
        : field === "precipitation"
          ? Number.isFinite(windy?.precipitation)
            ? `${formatNumber(windy.precipitation)} ${windy.precipitationUnit || "mm"} (3시간)`
            : "자료 없음"
          : formatRow(field, windyFields[field]);
    row.children[3].textContent = field === "rainProbability"
      ? formatRow(field, openMeteo.rainProbability)
      : field === "precipitation"
        ? Number.isFinite(openMeteo.precipitation)
          ? `${formatNumber(openMeteo.precipitation)} mm (1시간)`
          : "자료 없음"
        : formatRow(field, openMeteo[field]);
    const comparedValues = [kmaFields[field], windyFields[field], openMeteo[field]].filter(Number.isFinite);
    row.children[4].textContent = field === "precipitation"
      ? "누적기간 상이"
      : comparedValues.length > 1
        ? formatDifference(field, Math.max(...comparedValues) - Math.min(...comparedValues))
        : "비교 불가";
  });

  const kmaCard = document.querySelector(".kma-card");
  const kmaCurrent = kma?.observation || kmaValue;
  if (kmaCurrent) {
    kmaCard.querySelector(".provider-live").textContent = kma.observation ? "기상청 실황" : "초단기예보";
    kmaCard.querySelector(".provider-temp").textContent = Number.isFinite(kmaCurrent.temperature)
      ? `${formatNumber(kmaCurrent.temperature)}°`
      : "자료 없음";
    kmaCard.querySelector(".provider-temp").classList.remove("provider-unavailable");
    kmaCard.querySelector(".provider-condition").textContent =
      kma.observation ? "기상청 초단기실황" : kmaValue.condition;
    kmaCard.querySelector(".provider-foot strong").textContent =
      formatDate(kmaCurrent.time, { hour: "2-digit", minute: "2-digit" });
    document.querySelector("#kma-status").textContent = "연결됨";
    document.querySelector("#kma-status").className = "status-ready";
  }

  const providerCard = document.querySelector(".open-meteo-card");
  providerCard.querySelector(".provider-live").textContent = "실시간 예보";
  providerCard.querySelector(".provider-temp").innerHTML = `${formatNumber(current.temperature_2m)}<span>°</span>`;
  providerCard.querySelector(".provider-condition").textContent = weatherDescription(current.weather_code);
  providerCard.querySelector(".provider-foot strong").textContent = `${formatNumber(current.apparent_temperature)}°C`;
  document.querySelector("#open-meteo-provider-status").textContent = "연결됨";
  document.querySelector("#comparison-time").innerHTML = `<span>◷</span> ${formatDate(comparisonTime, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 공통 시각`;
  if (windy) {
    document.querySelector("#windy-status").textContent = "연결됨";
    document.querySelector("#windy-status").className = "status-ready";
    document.querySelector("#windy-provider-status").textContent = "GFS 예보";
    document.querySelector(".windy-card .provider-temp").textContent =
      Number.isFinite(windy.temperature) ? `${formatNumber(windy.temperature)}°` : "자료 없음";
    document.querySelector(".windy-card .provider-temp").classList.remove("provider-unavailable");
    document.querySelector(".windy-card .provider-condition").textContent =
      `기준 시각 ${formatDate(new Date(windy.time).toISOString(), { hour: "2-digit", minute: "2-digit" })}`;
    document.querySelector(".windy-card .provider-foot strong").textContent = Number.isFinite(windy.gust)
      ? `돌풍 ${formatNumber(windy.gust)} m/s`
      : "돌풍 자료 없음";
  }
}

function formatDifference(field, difference) {
  if (field === "temperature") return `${difference.toFixed(1)}°C`;
  if (field === "wind") return `${difference.toFixed(1)} m/s`;
  return `${difference.toFixed(0)}%`;
}

function getWindyCurrent(forecast, targetTime) {
  if (!forecast?.ts?.length) return null;
  const index = hourIndexNear(forecast.ts, targetTime);
  const read = (key) => Array.isArray(forecast[key]) ? forecast[key][index] : null;
  const u = read("wind_u-surface");
  const v = read("wind_v-surface");
  const speed = Number.isFinite(u) && Number.isFinite(v) ? Math.hypot(u, v) : null;
  const windUnit = forecast.units?.["wind_u-surface"] || "m*s-1";
  const windSpeed = Number.isFinite(speed)
    ? convertWindToMetersPerSecond(speed, windUnit)
    : null;
  const temperature = read("temp-surface");
  const temperatureUnit = forecast.units?.["temp-surface"];
  const temperatureCelsius = Number.isFinite(temperature)
    ? convertTemperatureToCelsius(temperature, temperatureUnit)
    : null;
  const gust = read("gust-surface");
  return {
    time: forecast.ts[index],
    temperature: temperatureCelsius,
    windSpeed,
    humidity: read("rh-surface"),
    precipitation: read("past3hprecip-surface"),
    precipitationUnit: forecast.units?.["past3hprecip-surface"],
    gust: Number.isFinite(gust) ? convertWindToMetersPerSecond(gust, forecast.units?.["gust-surface"] || windUnit) : null,
  };
}

function convertWindToMetersPerSecond(value, unit) {
  if (unit === "km/h" || unit === "km*h-1") return value / 3.6;
  if (unit === "kt" || unit === "knot") return value * 0.514444;
  return value;
}

function convertTemperatureToCelsius(value, unit) {
  if (unit === "°F" || unit === "F") return (value - 32) * 5 / 9;
  return value;
}

function renderCurrentWeather(location, data, kma) {
  const { current, hourly } = data;
  const index = hourIndexNear(hourly.time, current.time);
  const kmaForecast = nearestKmaForecast(kma, current.time);
  const observation = kma?.observation;
  const temperature = observation?.temperature ?? current.temperature_2m;
  const humidity = observation?.humidity ?? current.relative_humidity_2m;
  const windSpeed = observation?.windSpeed ?? current.wind_speed_10m;
  const windBearing = observation?.windDirection ?? current.wind_direction_10m;
  const rainProbability = kmaForecast?.precipitationProbability ?? hourly.precipitation_probability[index];
  const selectionName = location.displayName || location.name;
  document.querySelector(".current-topline > span:first-child").textContent =
    observation ? "기상청 초단기실황 · 실측" : "Open-Meteo 수치예보 모델";
  document.querySelector(".weather-date").textContent =
    `${selectionName} · ${formatDate(observation?.time || current.time, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
  document.querySelector("#current-temperature").innerHTML = `${formatNumber(temperature)}<span>°C</span>`;
  const observedPrecipitationType = observation?.precipitationType;
  document.querySelector("#current-condition").textContent = observation
    ? ({ 1: "비", 2: "비/눈", 3: "눈", 4: "소나기" }[observedPrecipitationType] || "강수 없음")
    : weatherDescription(current.weather_code);
  const weatherIcon = document.querySelector(".sun-cloud");
  weatherIcon.hidden = Boolean(observation) || current.weather_code >= 45 || current.weather_code === 3;
  weatherIcon.classList.toggle("clear-sky", !observation && (current.weather_code === 0 || current.weather_code === 1));
  weatherIcon.classList.toggle("overcast", !observation && current.weather_code === 3);
  document.querySelector("#current-apparent-temperature").textContent = observation
    ? "기상청 자료 없음"
    : `${formatNumber(current.apparent_temperature, 0)}°`;
  document.querySelector("#current-humidity").textContent = Number.isFinite(humidity)
    ? `${formatNumber(humidity, 0)}%`
    : "자료 없음";
  const direction = windDirection(windBearing);
  document.querySelector("#current-wind").textContent =
    `${formatNumber(windSpeed)} m/s${direction ? ` ${direction}` : ""}`;
  document.querySelector("#current-rain-probability").textContent = Number.isFinite(rainProbability)
    ? `${formatNumber(rainProbability, 0)}%`
    : "자료 없음";
  document.querySelector("#current-date-label").textContent =
    new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Seoul" })
      .format(new Date(current.time)).toUpperCase();
  document.querySelector("#location-status").textContent = selectionName;
  document.querySelector("#updated-time").textContent = formatDate(current.time, { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#open-meteo-status").textContent = "연결됨";
  document.querySelector("#open-meteo-status").className = "status-ready";
  document.querySelector(".weather-source-note").textContent = observation
    ? "기상청 초단기실황 · 격자 기반 관측정보"
    : "Open-Meteo 모델 예보 · 관측소 실측값이 아닙니다.";
  document.querySelector("#data-status-note").textContent = observation
    ? "현재 기상청 초단기실황 · 예보 비교에 Open-Meteo/Windy 모델 사용"
    : "Open-Meteo 모델 예보 · 관측소 실측값 아님";
  document.querySelector("#open-meteo-provider-status").textContent = "연결됨";
}

function setWeatherLoading(location) {
  document.querySelector("#location-status").textContent = `${location.displayName || location.name} · 예보 불러오는 중`;
  document.querySelector(".current-topline > span:first-child").textContent = "Open-Meteo 연결 중";
  document.querySelector(".weather-date").textContent = "예보 불러오는 중";
  document.querySelector("#current-temperature").innerHTML = "--<span>°C</span>";
  document.querySelector("#current-condition").textContent = "불러오는 중";
  document.querySelector("#current-apparent-temperature").textContent = "--°";
  document.querySelector("#current-humidity").textContent = "--%";
  document.querySelector("#current-wind").textContent = "-- m/s";
  document.querySelector("#current-rain-probability").textContent = "--%";
  document.querySelector("#current-date-label").textContent = "WEATHER FORECAST";
  document.querySelector("#updated-time").textContent = "불러오는 중";
  document.querySelector("#metric-max-temperature").innerHTML = "--<span>°C</span>";
  document.querySelector("#metric-max-wind").innerHTML = "--<span>m/s</span>";
  document.querySelector("#metric-rainfall").innerHTML = "--<span>mm</span>";
  document.querySelector("#metric-sunshine").innerHTML = "--<span>시간</span>";
  document.querySelectorAll(".metric-sub").forEach((item) => { item.textContent = "예보 자료 대기 중"; });
  document.querySelector("#insight-title").textContent = "실제 예보를 불러오는 중입니다";
  document.querySelector("#insight-description").textContent = "예보가 도착하면 기온·바람·강수 정보를 표시합니다.";
  document.querySelector("#insight-max-gust").textContent = "-- m/s";
  document.querySelector(".hourly-conditions").textContent = "시간별 예보 대기 중";
  document.querySelector(".week-list").textContent = "주간 예보 대기 중";
  document.querySelector(".chart-area").setAttribute("d", "");
  document.querySelector(".chart-temp-line").setAttribute("d", "");
  document.querySelector(".chart-rain-line").setAttribute("d", "");
  document.querySelector(".chart-current-label").textContent = "--°";
  document.querySelectorAll(".work-card .work-status").forEach((item) => { item.textContent = "예보 대기 중"; });
  document.querySelectorAll(".work-card p").forEach((item) => { item.textContent = "예보 자료를 불러오는 중입니다."; });
  document.querySelectorAll(".work-card .work-reason strong").forEach((item) => { item.textContent = "--"; });
  document.querySelector("#kma-status").textContent = "연결 중";
  document.querySelector("#kma-status").className = "status-loading";
  document.querySelector(".kma-card .provider-live").textContent = "연결 중";
  document.querySelector(".kma-card .provider-temp").textContent = "--";
  document.querySelector(".kma-card .provider-condition").textContent = "기상청 자료를 확인합니다.";
  document.querySelector("#windy-status").textContent = "연결 중";
  document.querySelector("#windy-status").className = "status-loading";
  document.querySelector("#windy-provider-status").textContent = "연결 중";
  document.querySelector(".windy-card .provider-temp").textContent = "--";
  document.querySelector(".windy-card .provider-condition").textContent = "Windy 자료를 확인합니다.";
  document.querySelectorAll(".comparison-table tbody tr[data-weather]").forEach((row) => {
    row.children[1].textContent = "미연결";
    row.children[2].textContent = "미연결";
    row.children[3].textContent = "--";
    row.children[4].textContent = "비교 불가";
  });
  document.querySelector("#open-meteo-provider-status").textContent = "연결 중";
}

async function loadLocationWeather(location, key = selectedLocationKey, force = false) {
  const requestId = ++weatherRequestId;
  setWeatherLoading(location);
  try {
    const data = await fetchWeather(location, force);
    if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
    renderCurrentWeather(location, data);
    renderMetrics(data);
    renderProviderComparison(data);
    renderHourlyForecast(data);
    renderWeeklyForecast(location, data);
    renderFarmWeather(data);
    updateWeatherMap();
    const sourceRequests = [
      fetchKmaForecast(location, force).then((kma) => {
        if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
        renderCurrentWeather(location, data, kma);
        renderProviderComparison(data, kma, windyCache.get(locationCacheKey(location))?.data);
      }).catch((error) => {
        if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
        console.error("기상청 실황·예보를 불러오지 못했습니다.", error);
        document.querySelector("#kma-status").textContent = "미연결";
        document.querySelector("#kma-status").className = "status-unavailable";
        document.querySelector(".kma-card .provider-condition").textContent = error.message;
      }),
      fetchWindyForecast(location, force).then((windy) => {
        if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
        renderProviderComparison(data, kmaCache.get(locationCacheKey(location))?.data, windy);
      }).catch((error) => {
        if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
        console.error("Windy Point Forecast를 불러오지 못했습니다.", error);
        document.querySelector("#windy-status").textContent =
          error.message.includes("키가 설정되지 않았습니다") ? "키 미설정" : "미연결";
        document.querySelector("#windy-status").className = "status-unavailable";
        document.querySelector("#windy-provider-status").textContent = "미연결";
        document.querySelector(".windy-card .provider-condition").textContent = error.message;
        renderProviderComparison(data, kmaCache.get(locationCacheKey(location))?.data, null);
      }),
    ];
    await Promise.allSettled(sourceRequests);
  } catch (error) {
    if (requestId !== weatherRequestId || key !== selectedLocationKey) return;
    console.error("Open-Meteo 예보를 불러오지 못했습니다.", error);
    document.querySelector("#location-status").textContent = "예보를 불러오지 못했습니다";
    document.querySelector("#open-meteo-status").textContent = "연결 실패";
    document.querySelector("#open-meteo-status").className = "status-unavailable";
    document.querySelector("#open-meteo-provider-status").textContent = "연결 실패";
    document.querySelector("#data-status-note").textContent = "네트워크 상태를 확인한 뒤 새로고침해 주세요.";
    document.querySelector(".weather-date").textContent = "예보 자료 없음";
    document.querySelector("#current-condition").textContent = "예보 자료 없음";
    document.querySelector("#insight-title").textContent = "예보 자료를 불러오지 못했습니다";
    document.querySelector("#insight-description").textContent = "인터넷 연결을 확인하고 새로고침해 주세요. 예시 자료로 대체하지 않습니다.";
    document.querySelector(".hourly-conditions").textContent = "시간별 예보를 불러오지 못했습니다.";
    document.querySelector(".week-list").textContent = "주간 예보를 불러오지 못했습니다.";
    showToast("실제 기상 예보를 불러오지 못했습니다.");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setupDashboardTabs() {
  const overview = document.querySelector(".overview-grid");
  const metrics = document.querySelector(".metrics-grid");
  const comparison = document.querySelector("#comparison");
  const middleGrid = document.querySelector(".middle-grid");
  const farm = document.querySelector("#farm-work");
  const bottomGrid = document.querySelector(".bottom-grid");
  const currentWeather = overview.querySelector(".current-weather");
  const workInsight = overview.querySelector(".risk-card");
  const mapCard = middleGrid.querySelector(".map-card");
  const hourlyForecast = middleGrid.querySelector(".hourly-card");
  const weeklyForecast = bottomGrid.querySelector(".weekly-card");
  const accuracy = bottomGrid.querySelector(".accuracy-card");
  const tabBar = document.querySelector(".dashboard-tabs");
  const panels = [
    { key: "home", id: "tab-home", label: "오늘 날씨" },
    { key: "comparison", id: "tab-comparison", label: "기관별 비교" },
    { key: "forecast", id: "tab-forecast", label: "시간·주간 예보" },
    { key: "farm", id: "tab-farm", label: "농작업 판단" },
  ];

  const panelElements = Object.fromEntries(panels.map(({ key, id, label }) => {
    const panel = document.createElement("section");
    panel.id = id;
    panel.className = "tab-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", label);
    panel.setAttribute("aria-labelledby", `tab-${key}-button`);
    panel.hidden = key !== "home";
    return [key, panel];
  }));
  const homeGrid = document.createElement("div");
  homeGrid.className = "home-weather-grid";
  homeGrid.append(currentWeather, mapCard);
  panelElements.home.append(homeGrid);
  panelElements.comparison.append(comparison);
  const weeklyAccuracy = document.createElement("div");
  weeklyAccuracy.className = "weekly-accuracy-grid";
  weeklyAccuracy.append(weeklyForecast, accuracy);
  panelElements.forecast.append(metrics, hourlyForecast, weeklyAccuracy);
  const farmContent = document.createElement("div");
  farmContent.className = "farm-tab-content";
  farmContent.append(workInsight, farm);
  panelElements.farm.append(farmContent);

  overview.remove();
  middleGrid.remove();
  bottomGrid.remove();
  tabBar.after(...Object.values(panelElements));
}

function activateDashboardTab(tabKey, updateHistory = false) {
  const panel = document.querySelector(`#tab-${tabKey}`);
  if (!panel) return;

  document.querySelectorAll(".dashboard-tab").forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });
  document.querySelectorAll(".tab-panel").forEach((tabPanel) => {
    tabPanel.hidden = tabPanel !== panel;
  });
  const activeNavigationLink = document.querySelector(`.nav-link[data-tab="${tabKey}"]`);
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link === activeNavigationLink);
  });

  if (updateHistory) {
    const activeTab = document.querySelector(`.dashboard-tab[data-tab="${tabKey}"]`);
    history.replaceState(null, "", `#${tabKey}`);
    document.querySelector(".breadcrumb strong").textContent = activeTab.textContent.trim();
  }
  if (tabKey === "home" && weatherMap) {
    window.setTimeout(() => weatherMap.relayout(), 0);
  }
}

setupDashboardTabs();

document.querySelectorAll(".dashboard-tab").forEach((tab, index, tabs) => {
  tab.addEventListener("click", () => activateDashboardTab(tab.dataset.tab, true));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    activateDashboardTab(tabs[nextIndex].dataset.tab, true);
  });
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    activateDashboardTab(link.dataset.tab, true);
  });
});

document.querySelectorAll('a[href^="#"]:not(.brand):not(.nav-link)').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    const panel = target?.closest(".tab-panel");
    if (!panel) return;
    event.preventDefault();
    activateDashboardTab(panel.id.replace("tab-", ""), true);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const initialTab = {
  comparison: "comparison",
  forecast: "forecast",
  farm: "farm",
  "weather-map": "home",
  dashboard: "home",
}[location.hash.slice(1)] || "home";
activateDashboardTab(initialTab);

function readText(element, fallback = "화면에 제공되지 않음") {
  return element?.textContent?.trim().replace(/\s+/g, " ") || fallback;
}

function createGeminiPrompt(question) {
  const selectedOption = document.querySelector("#location-select").selectedOptions[0];
  const currentWeather = document.querySelector(".current-weather");
  const comparisonRows = [...document.querySelectorAll(".comparison-table tbody tr")].map((row) =>
    `- ${[...row.cells].map((cell) => readText(cell)).join(" | ")}`,
  );
  const hourlyForecast = [...document.querySelectorAll(".hourly-conditions > div")].map((hour) => {
    const values = [...hour.children].map((item) => readText(item));
    return `- ${values.join(" · ")}`;
  });
  const weeklyForecast = [...document.querySelectorAll(".week-day")].map((day) => {
    const dayName = readText(day.querySelector(".day-name"));
    const condition = readText(day.querySelector(".week-condition"));
    const rain = readText(day.querySelector(".week-rain"));
    const temperatures = readText(day.querySelector("strong"));
    return `- ${dayName}: ${condition}, 강수확률 ${rain}, 최고/최저 ${temperatures}`;
  });
  const farmGuidance = [...document.querySelectorAll(".work-card")].map((work) => {
    const reasons = [...work.querySelectorAll(".work-reason > *")].map((item) => readText(item)).join(" ");
    return `- ${readText(work.querySelector(".work-label"))} (${readText(work.querySelector(".work-status"))}): ${readText(work.querySelector("p"))} 근거: ${reasons}`;
  });
  const metrics = [...document.querySelectorAll(".metric-card")].map((metric) =>
    `- ${readText(metric.querySelector(".metric-heading > span"))}: ${readText(metric.querySelector(".metric-value"))} (${readText(metric.querySelector(".metric-sub"))})`,
  );
  const regionalWeather = Object.values(locations).map((location) => {
    const data = weatherCache.get(locationCacheKey(location))?.data;
    if (!data) return `- ${location.name}: 예보 자료 없음`;
    return `- ${location.name}: 기온 ${formatNumber(data.current.temperature_2m)}°C, 풍속 ${formatNumber(data.current.wind_speed_10m)}m/s, 습도 ${formatNumber(data.current.relative_humidity_2m, 0)}%, 모델 출처 Open-Meteo`;
  });
  const dataNotice = readText(document.querySelector(".sidebar-status > p"));
  const mapLayer = readText(document.querySelector("#map-legend-title"));
  const mapRange = readText(document.querySelector("#map-legend-range"));

  return `당신은 시설·노지 재배와 기상 리스크를 함께 고려하는 신중한 농업 기상 상담자입니다. 아래 대시보드 정보를 모두 종합해 농장주의 질문에 답하세요.

[농장주의 질문]
${question || "질문을 입력해 주세요."}

[지역과 기준 시각]
- 선택 지역: ${readText(selectedOption)}
- 현재 주요 정보 기준: ${readText(currentWeather?.querySelector(".current-topline"))}
- 현재 날씨 기준: ${readText(currentWeather?.querySelector(".weather-date"))}
- 현재 상태: ${readText(currentWeather?.querySelector(".current-temp > span"))}, 기온 ${readText(currentWeather?.querySelector("#current-temperature"))}, 습도 ${readText(currentWeather?.querySelector("#current-humidity"))}, 바람 ${readText(currentWeather?.querySelector("#current-wind"))}, 강수확률 ${readText(currentWeather?.querySelector(".current-details > div:last-child strong"))}
- 내 위치를 선택한 경우 해당 좌표를 직접 조회합니다.
- 데이터 연결 상태: ${dataNotice}
- 중요: 아래 기상 수치는 Open-Meteo 수치예보 모델에서 가져온 실제 예보 자료이며, 농장 현장이나 관측소의 실측값은 아닙니다. 관측 사실로 오해되지 않도록 '모델 예보'임을 밝히고, 현장 관측과 공식 예보를 함께 확인하도록 안내하세요.

[주요 기상 지표]
${metrics.join("\n")}

[기상기관별 같은 시각 예보 비교]
${comparisonRows.join("\n")}
- 기상청·Windy 연결 상태: ${readText(document.querySelector("#kma-status"))} · ${readText(document.querySelector("#windy-status"))}
- 세 예보는 제공 모델과 공간 해상도가 다르므로 차이는 같은 시각·같은 단위의 수치 범위로만 해석하세요.
- 강수량은 각 API의 누적 기간이 달라 직접 차이를 비교하지 않습니다. Windy 강수확률은 제공되지 않습니다.

[시간별 예보]
${hourlyForecast.join("\n")}

[주간 예보]
${weeklyForecast.join("\n")}

[지역별 지도 기상 요약]
- 현재 지도 레이어: ${mapLayer} (${mapRange})
${regionalWeather.join("\n")}

[대시보드 농작업 안내와 기상 근거]
${farmGuidance.join("\n")}
- 작업 안내는 예보 지표를 보여주는 참고 정보일 뿐이며 작업 허가/금지 판정이 아닙니다.

[예보 정확도 참고]
- ${readText(document.querySelector(".accuracy-footnote"))}

[답변 원칙]
1. 먼저 질문에 직접 답하되, 모델 예보만으로 안전을 보장하지 마세요. 작물·농약 기준과 현장 조건이 없으면 조건부 판단으로 제한하세요.
2. 질문의 작물·작업(예: 토마토 덮개 설치)을 특정해 판단하세요. 작물 품종, 생육 단계, 재배 형태(노지/시설), 덮개 재질·목적이 제공되지 않았으면 사실처럼 추측하지 말고 결론에 미치는 영향을 밝히세요.
3. 현재 기온뿐 아니라 최저/최고기온, 시간대별 변화, 강수 시점·강수량, 풍속, 습도, 일조, 기관 간 예보 편차와 주간 변화를 함께 검토하세요. 질문에 필요한 정보가 이 화면에 없으면 '정보 없음'으로 표시하세요.
4. 권고의 이유를 구체적인 제공 수치와 연결하고, 정보가 충돌하거나 예보 신뢰도가 낮으면 그 점과 판단을 바꿀 조건을 설명하세요. 자료에 없는 임계값이나 농약·작물 기준을 만들어내지 마세요.
5. 가능한 경우 오늘의 작업 시간대와 확인할 현장 항목(작물/토양 상태, 덮개 아래 과열·환기, 실제 온도 등)을 짧은 체크리스트로 제시하세요.
6. 마지막에 신뢰 수준(낮음/보통/높음)과 그 이유, 작업 직전 확인할 공식 예보·현장 관측을 제안하세요. 모델 예보만 제공되므로 신뢰 수준을 과장하지 마세요.

[답변 형식]
- 판단:
- 근거(기상 종합):
- 권장 시점과 실행 방법:
- 추가 확인이 필요한 정보:
- 신뢰 수준 및 한계:`;
}

const geminiDialog = document.querySelector("#gemini-dialog");
const geminiQuestion = document.querySelector("#gemini-question");
const geminiAnswer = document.querySelector("#gemini-answer");
const geminiAnswerContent = document.querySelector("#gemini-answer-content");
const geminiAskButton = document.querySelector("#ask-gemini");

document.querySelector("#open-gemini-dialog").addEventListener("click", () => {
  geminiAnswer.hidden = true;
  geminiAnswerContent.textContent = "";
  geminiDialog.showModal();
  geminiQuestion.focus();
});

geminiQuestion.addEventListener("input", () => {
  geminiAnswer.hidden = true;
});

geminiQuestion.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    geminiAskButton.click();
  }
});

geminiAskButton.addEventListener("click", async () => {
  const question = geminiQuestion.value.trim();
  if (!question) {
    geminiQuestion.focus();
    showToast("궁금한 내용을 먼저 입력해 주세요.");
    return;
  }

  const selectedLocation = selectedLocationKey === "__current__" ? currentLocationWeather : locations[selectedLocationKey];
  if (!selectedLocation || !weatherCache.has(locationCacheKey(selectedLocation))) {
    showToast("실제 기상 예보를 불러온 뒤 질문해 주세요.");
    return;
  }

  geminiAskButton.disabled = true;
  geminiAskButton.innerHTML = '<span class="gemini-loading" aria-hidden="true"></span> 답변을 기다리는 중';
  geminiAnswer.hidden = false;
  geminiAnswerContent.textContent = "실제 기상 예보를 확인해 Gemini가 답변을 작성하고 있습니다.";
  geminiAnswerContent.classList.add("is-loading");

  try {
    const response = await fetch("/api/ask-gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, prompt: createGeminiPrompt(question) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Gemini 답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (typeof result.answer !== "string" || !result.answer.trim()) {
      throw new Error("Gemini에서 답변을 받지 못했습니다. 질문을 바꿔 다시 시도해 주세요.");
    }
    geminiAnswerContent.textContent = result.answer.trim();
    geminiAnswerContent.classList.remove("is-loading");
  } catch (error) {
    console.error("Gemini 답변 요청에 실패했습니다.", error);
    geminiAnswerContent.textContent = error.message || "Gemini에 연결할 수 없습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.";
    geminiAnswerContent.classList.remove("is-loading");
  } finally {
    geminiAskButton.disabled = false;
    geminiAskButton.innerHTML = '<span aria-hidden="true">✦</span> 다시 질문하기';
  }
});

document.querySelector("#location-select").addEventListener("change", (event) => {
  const isCurrentLocation = event.target.value === "__current__" && currentLocationWeather;
  const selectedLocation = isCurrentLocation ? currentLocationWeather : locations[event.target.value];
  if (!selectedLocation) return;

  if (!isCurrentLocation) {
    locationRequestId += 1;
    document.querySelector("#my-location-button").disabled = false;
    document.querySelector("#my-location-button span").textContent = "내 위치";
  }
  document.querySelector(".location-pin").setAttribute("aria-label", selectedLocation.displayName || selectedLocation.name);
  selectedLocationKey = event.target.value;
  loadLocationWeather(selectedLocation, selectedLocationKey);
  updateWeatherMap();
  if (weatherMap) {
    weatherMap.panTo(new window.kakao.maps.LatLng(...selectedLocation.coordinates));
    weatherMap.setLevel(8);
  }
});

document.querySelector("#my-location-button").addEventListener("click", requestCurrentLocation);

document.querySelector("#refresh-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.classList.add("is-refreshing");
  const location = selectedLocationKey === "__current__" ? currentLocationWeather : locations[selectedLocationKey];
  Promise.all([
    loadLocationWeather(location, selectedLocationKey, true),
    ...Object.values(locations).map((region) => fetchWeather(region, true).then(updateWeatherMap)),
  ]).finally(() => {
    button.disabled = false;
    button.classList.remove("is-refreshing");
  });
});

document.querySelector("#detail-toggle").addEventListener("click", () => {
  document.querySelector(".comparison-table").classList.toggle("expanded");
  showToast("연결되지 않은 기관은 비교할 수 없습니다.");
});

document.querySelector("#map-layer-select").addEventListener("change", updateWeatherMap);

document.querySelector("#crop-button").addEventListener("click", () => {
  showToast("작물별 기준 정보는 아직 연결되지 않았습니다.");
});

document.querySelector(".notification-button").addEventListener("click", () => {
  showToast("현재 확인할 새 알림이 없습니다.");
});

document.querySelector("#location-select").dispatchEvent(new Event("change", { bubbles: true }));
loadKakaoMap();
requestCurrentLocation({ silent: true });
Promise.allSettled(Object.values(locations).map((region) =>
  fetchWeather(region).then(updateWeatherMap),
));
