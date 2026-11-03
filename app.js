const locations = {
  gongju: {
    name: "충청남도 공주시",
    city: "공주",
    coordinates: [36.4467, 127.119],
    temperature: "19",
    humidity: "64%",
    wind: "2.8 m/s",
    sources: [[18.5, 2.4, 65, 20, 0], [19.2, 3.1, 62, 10, 0], [18.9, 2.8, 64, 15, 0]],
  },
  yesan: {
    name: "충청남도 예산군",
    city: "예산",
    coordinates: [36.6828, 126.8483],
    temperature: "18",
    humidity: "67%",
    wind: "2.5 m/s",
    sources: [[17.6, 2.2, 67, 15, 0], [18.2, 2.9, 65, 10, 0], [17.9, 2.5, 66, 15, 0]],
  },
  naju: {
    name: "전라남도 나주시",
    city: "나주",
    coordinates: [35.016, 126.7108],
    temperature: "21",
    humidity: "61%",
    wind: "2.2 m/s",
    sources: [[20.4, 1.9, 61, 10, 0], [21.1, 2.7, 59, 5, 0], [20.8, 2.2, 60, 10, 0]],
  },
  sangju: {
    name: "경상북도 상주시",
    city: "상주",
    coordinates: [36.4109, 128.1591],
    temperature: "17",
    humidity: "69%",
    wind: "3.0 m/s",
    sources: [[16.8, 2.6, 69, 20, 0], [17.4, 3.4, 66, 15, 0], [17.1, 3.0, 68, 20, 0]],
  },
};

const toast = document.querySelector("#toast");
let toastTimeout;
let weatherMap;
let weatherOverlays = [];
let selectedLocationKey = "gongju";
let currentLocationWeather;
let currentPosition;
let currentLocationOverlay;
let currentLocationCircle;
let locationRequestId = 0;
const mapMessage = document.querySelector("#map-message");
const mapLayerLabels = {
  temperature: { label: "기온", unit: "°", sourceIndex: 0 },
  wind: { label: "풍속", unit: "m/s", sourceIndex: 1 },
  rain: { label: "강수확률", unit: "%", sourceIndex: 3 },
};

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
  const values = Object.values(locations).map((location) =>
    location.sources.reduce((sum, source) => sum + source[settings.sourceIndex], 0) / location.sources.length,
  );
  const minimum = Math.floor(Math.min(...values));
  const maximum = Math.ceil(Math.max(...values));
  document.querySelector("#map-legend-title").textContent = settings.label;
  document.querySelector("#map-legend-range").textContent = `${minimum}${settings.unit} — ${maximum}${settings.unit}`;
  if (!weatherMap || weatherOverlays.length === 0) return;

  weatherOverlays.forEach(({ element, key, overlay }) => {
    const location = locations[key];
    const average = location.sources.reduce((sum, source) => sum + source[settings.sourceIndex], 0) / location.sources.length;
    const value = settings.sourceIndex === 0 ? average.toFixed(1) : settings.sourceIndex === 1 ? average.toFixed(1) : Math.round(average);
    element.replaceChildren();
    const city = document.createElement("span");
    city.className = "weather-map-city";
    city.textContent = location.city;
    const weather = document.createElement("strong");
    weather.textContent = `${value}${settings.unit}`;
    element.append(city, weather);
    element.classList.toggle("selected", key === selectedLocationKey);
    element.setAttribute("aria-label", `${location.name} ${settings.label} ${value}${settings.unit}`);
    overlay.setZIndex(key === selectedLocationKey ? 3 : 1);
  });
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

function getDistanceKm(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(second[0] - first[0]);
  const longitudeDelta = toRadians(second[1] - first[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(first[0])) * Math.cos(toRadians(second[0]))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function findNearestLocation(coordinates) {
  return Object.values(locations).reduce((nearest, location) => {
    const distance = getDistanceKm(coordinates, location.coordinates);
    return distance < nearest.distance ? { location, distance } : nearest;
  }, { location: null, distance: Infinity }).location;
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

  const nearestLocation = findNearestLocation([latitude, longitude]);
  const placeName = address || `위치 ${formatCoordinates(latitude, longitude)}`;
  currentPosition = { latitude, longitude, accuracy };
  currentLocationWeather = {
    ...nearestLocation,
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
  const forecastText = address
    ? "기상 수치는 가장 가까운 지역의 화면 설계용 예시입니다."
    : "주소 변환을 할 수 없어 좌표로 표시하며, 기상 수치는 가까운 지역의 예시입니다.";
  showToast(`${placeName}${accuracyText}. ${forecastText}`);
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

  setMapMessage("카카오맵 연결 중", "지도와 지역별 기상 예시 데이터를 불러오고 있습니다.");
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

function updateLocationWeather(location) {
  const { sources } = location;
  const sourceTemperatures = document.querySelectorAll(".provider-temp");
  const sourceRows = document.querySelectorAll(".comparison-table tbody tr");
  const average = (index) => sources.reduce((sum, source) => sum + source[index], 0) / sources.length;
  const formatRowValue = (rowIndex, value) => {
    if (rowIndex === 0) return `${value.toFixed(1)}°C`;
    if (rowIndex === 1) return `${value.toFixed(1)} m/s`;
    if (rowIndex === 2 || rowIndex === 3) return `${Math.round(value)}%`;
    return `${value} mm`;
  };

  sources.forEach((source, sourceIndex) => {
    sourceTemperatures[sourceIndex].innerHTML = `${source[0].toFixed(1)}<span>°</span>`;
  });
  sourceRows.forEach((row, rowIndex) => {
    sources.forEach((source, sourceIndex) => {
      row.children[sourceIndex + 1].textContent = formatRowValue(rowIndex, source[rowIndex]);
    });
    const values = sources.map((source) => source[rowIndex]);
    const difference = Math.max(...values) - Math.min(...values);
    row.children[4].textContent = difference === 0
      ? "일치"
      : rowIndex === 0 ? `${difference.toFixed(1)}°` : formatRowValue(rowIndex, difference);
  });

  const workValues = document.querySelectorAll(".work-card .work-reason strong");
  const averageWind = average(1);
  const averageHumidity = average(2);
  const averageRainChance = average(3);
  workValues[0].textContent = `${averageWind.toFixed(1)} m/s`;
  workValues[1].textContent = `${Math.round(averageRainChance)}%`;
  workValues[2].textContent = `${average(4).toFixed(0)} mm`;
  workValues[3].textContent = `${Math.round(averageHumidity)}%`;
  workValues[4].textContent = `${average(0).toFixed(1)}°C`;
  workValues[5].textContent = `${Math.round(averageRainChance)}%`;
  workValues[6].textContent = `${Math.round(averageHumidity)}%`;
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
    const [temperature, wind, humidity, rainChance, rainAmount] = [0, 1, 2, 3, 4].map((index) =>
      location.sources.reduce((sum, source) => sum + source[index], 0) / location.sources.length,
    );
    return `- ${location.name}: 기온 ${temperature.toFixed(1)}°C, 풍속 ${wind.toFixed(1)}m/s, 습도 ${Math.round(humidity)}%, 강수확률 ${Math.round(rainChance)}%, 강수량 ${rainAmount.toFixed(1)}mm (기관 평균 예시)`;
  });
  const accuracy = [...document.querySelectorAll(".accuracy-bars > div")].map((row) =>
    `- ${[...row.children].map((item) => readText(item)).join(": ")}`,
  );
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
- 현재 위치를 선택한 경우에도 예보값은 가장 가까운 등록 지역의 예시 자료일 수 있습니다.
- 데이터 연결 상태: ${dataNotice}
- 중요: 이 화면은 실제 기상 API가 연결되기 전의 설계용 예시 데이터입니다. 아래 값은 실황이나 공식 예보가 아닙니다. 실제 관측인 것처럼 말하거나, 현재의 실제 기상 상태를 단정하지 마세요. 답변은 반드시 '예시 데이터에 기반한 조건부 판단'으로 표시하고 실제 작업 전 최신 지역 예보와 농장 현장 상태를 확인하라고 안내하세요.

[주요 기상 지표]
${metrics.join("\n")}

[기상기관별 같은 시각 예보 비교]
${comparisonRows.join("\n")}
- 기관별 예보 차이를 비교하고, 서로 다른 값은 범위와 불확실성으로 표현하세요. 평균값 하나만으로 차이를 숨기지 마세요.

[시간별 예보]
${hourlyForecast.join("\n")}

[주간 예보]
${weeklyForecast.join("\n")}

[지역별 지도 기상 요약]
- 현재 지도 레이어: ${mapLayer} (${mapRange})
${regionalWeather.join("\n")}

[대시보드 농작업 안내와 기상 근거]
${farmGuidance.join("\n")}
- 위 작업 안내도 예시 자료 기반이며 확정적인 작업 허가/금지로 간주하지 마세요.

[예보 정확도 참고]
${accuracy.join("\n")}
- ${readText(document.querySelector(".accuracy-footnote"))}

[답변 원칙]
1. 먼저 질문에 직접 답하고, 권고를 '지금 실행 / 조건 확인 후 실행 / 보류' 중 하나로 분명히 제시하세요. 데이터가 예시뿐이라 실제 결정을 내릴 근거가 부족하면 그 한계를 먼저 밝혀 조건부 답변으로 제한하세요.
2. 질문의 작물·작업(예: 토마토 덮개 설치)을 특정해 판단하세요. 작물 품종, 생육 단계, 재배 형태(노지/시설), 덮개 재질·목적이 제공되지 않았으면 사실처럼 추측하지 말고 결론에 미치는 영향을 밝히세요.
3. 현재 기온뿐 아니라 최저/최고기온, 시간대별 변화, 강수 시점·강수량, 풍속, 습도, 일조, 기관 간 예보 편차와 주간 변화를 함께 검토하세요. 질문에 필요한 정보가 이 화면에 없으면 '정보 없음'으로 표시하세요.
4. 권고의 이유를 구체적인 제공 수치와 연결하고, 정보가 충돌하거나 예보 신뢰도가 낮으면 그 점과 판단을 바꿀 조건을 설명하세요. 자료에 없는 임계값이나 농약·작물 기준을 만들어내지 마세요.
5. 가능한 경우 오늘의 작업 시간대와 확인할 현장 항목(작물/토양 상태, 덮개 아래 과열·환기, 실제 온도 등)을 짧은 체크리스트로 제시하세요.
6. 마지막에 신뢰 수준(낮음/보통/높음)과 그 이유, 작업 직전 확인할 공식 예보·현장 관측을 제안하세요. 예시 자료뿐이면 신뢰 수준은 낮음으로 표시하세요.

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

  geminiAskButton.disabled = true;
  geminiAskButton.innerHTML = '<span class="gemini-loading" aria-hidden="true"></span> 답변을 기다리는 중';
  geminiAnswer.hidden = false;
  geminiAnswerContent.textContent = "대시보드 기상정보를 확인해 Gemini가 답변을 작성하고 있습니다.";
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
  const kmaForecast = selectedLocation.sources[0];
  document.querySelector("#current-temperature").innerHTML = `${kmaForecast[0].toFixed(1)}<span>°C</span>`;
  document.querySelector("#current-humidity").textContent = `${kmaForecast[2]}%`;
  document.querySelector("#current-wind").textContent = `${kmaForecast[1].toFixed(1)} m/s`;
  document.querySelector(".current-details > div:last-child strong").textContent = `${kmaForecast[3]}%`;
  document.querySelector(".weekly-location").textContent = `${selectedLocation.displayName || selectedLocation.name.split(" ").at(-1)} · 예시`;
  document.querySelector("#location-status").textContent = isCurrentLocation
    ? `내 위치 · ${currentPosition.latitude.toFixed(3)}, ${currentPosition.longitude.toFixed(3)}`
    : `${selectedLocation.name} · 지역 예시`;
  selectedLocationKey = event.target.value;
  updateLocationWeather(selectedLocation);
  updateWeatherMap();
  if (weatherMap) {
    weatherMap.panTo(new window.kakao.maps.LatLng(...selectedLocation.coordinates));
    weatherMap.setLevel(8);
  }
  if (!isCurrentLocation && event.isTrusted) showToast(`${selectedLocation.name}의 예시 기상정보를 표시합니다.`);
});

document.querySelector("#my-location-button").addEventListener("click", requestCurrentLocation);

document.querySelector("#refresh-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.classList.add("is-refreshing");
  document.querySelector("#updated-time").textContent = "방금 전";
  window.setTimeout(() => {
    button.disabled = false;
    button.classList.remove("is-refreshing");
    showToast("예시 데이터를 새로고침했습니다.");
  }, 650);
});

document.querySelector("#detail-toggle").addEventListener("click", () => {
  document.querySelector(".comparison-table").classList.toggle("expanded");
  showToast("기관별 비교 예시 데이터를 확인하고 있습니다.");
});

document.querySelector("#map-layer-select").addEventListener("change", updateWeatherMap);

document.querySelector("#crop-button").addEventListener("click", () => {
  showToast("작물 설정은 기상 데이터 연동 단계에서 제공할 예정입니다.");
});

document.querySelector(".notification-button").addEventListener("click", () => {
  showToast("현재 확인할 새 알림이 없습니다.");
});

document.querySelector("#location-select").dispatchEvent(new Event("change", { bubbles: true }));
loadKakaoMap();
requestCurrentLocation({ silent: true });
