# 하늘밭 농업 기상 대시보드

농업인이 현재 기상, 지역 지도, 예보 비교와 농작업 정보를 큰 탭으로 확인할 수 있는 반응형 웹 대시보드입니다.

## 실행

저장소 루트에서 정적 웹 서버를 실행하거나 Vercel에 저장소를 연결하세요. 별도 빌드 명령은 필요하지 않습니다.

```powershell
python -m http.server 8765
```

브라우저에서 `http://localhost:8765`를 엽니다. 위치 기능과 배포 환경은 HTTPS가 필요합니다.

## 카카오 지도

`config.js`에 카카오 개발자 콘솔의 JavaScript 키를 설정하고, 카카오 개발자 콘솔에서 `localhost` 및 배포 도메인을 허용 목록에 등록하세요. 지도는 키가 없거나 SDK를 불러오지 못하면 안내 메시지를 표시합니다.

## 기상 정보와 Gemini

지도에서 위치를 누르면 선택한 좌표로 기상청·Windy·Open-Meteo 예보를 조회합니다. 현재 관측값은 기상청 ASOS 관측소 목록에서 가장 가까운 관측소를 찾아 시간 관측자료를 표시하고, 관측소 이름·직선거리·관측 시각을 함께 보여줍니다. ASOS 시간자료는 전일까지 제공될 수 있으므로 화면의 관측 시각을 확인하세요. 가까운 관측소 자료를 조회하지 못하면 기상청 격자 초단기실황을 출처와 함께 표시하며, API 실패 시 임의의 날씨값으로 대체하지 않습니다.

예보 비교는 기상청 단기예보의 가장 가까운 제공 시각에 맞춰 Windy·Open-Meteo 값을 정렬합니다. KMA 격자, Windy 좌표 반올림, 각 예보 모델의 공간 해상도와 갱신 시각은 서로 다를 수 있습니다. 지도 배경의 지역별 값은 실제 Open-Meteo 모델 예보이며 관측소 실측값이 아닙니다.

Vercel 프로젝트의 **Settings → Environment Variables**에 다음 서버 환경변수를 등록한 뒤 재배포하세요.

- `KMA_SERVICE_KEY`: 공공데이터포털에서 발급한 기상청 단기예보 서비스 키(디코딩된 키 값)
- `KMA_ASOS_SERVICE_KEY` (선택): 가장 가까운 ASOS 관측소·시간 관측자료를 조회할 키. 비워 두면 `KMA_SERVICE_KEY`를 사용합니다. 해당 키에 ASOS 관측소정보 및 시간자료 API 활용 승인이 있어야 합니다.
- `WINDY_POINT_FORECAST_API_KEY`: Windy Point Forecast 전용 운영 API 키. Map Forecast 등 다른 Windy 제품의 키와 다릅니다.
- `GEMINI_API_KEY`: Gemini 상담용 키

API 키는 `/api` 서버리스 함수에서만 사용하며 브라우저 코드에 포함하지 않습니다. Windy의 API Testing 자료는 임의 변경된 개발용 예보이며 운영에 사용할 수 없으므로, 정식 Point Forecast 키를 등록하세요. 키가 없거나 호출이 실패하면 숫자를 꾸며내지 않고 미연결/오류 상태를 표시합니다.
공공데이터포털의 인코딩/디코딩 키 중 `KMA_SERVICE_KEY`에는 디코딩된 값을 설정하세요. 서버가 요청 URL에 안전하게 인코딩합니다. 단기예보 서비스 승인은 ASOS 시간 관측자료 서비스 승인과 별개이며, ASOS 조회가 필요하면 해당 API 활용 신청도 승인되어야 합니다. 채팅이나 공개 저장소에 노출된 키는 폐기·재발급한 뒤 Vercel 환경변수에 등록하세요.

Open-Meteo는 별도 키 없이 브라우저에서 호출합니다. 모델 예보는 농장이나 관측소의 실측값이 아닙니다. ASOS 시간자료는 전일까지 제공될 수 있으며, 가장 가까운 관측소와 농장 사이의 거리·관측 시각 차이를 고려하세요. 출처: [Open-Meteo](https://open-meteo.com/), [기상청 단기예보 API](https://www.data.go.kr/data/15084084/openapi.do), [기상청 ASOS 시간자료 API](https://www.data.go.kr/data/15057210/openapi.do), [Windy Point Forecast API](https://api.windy.com/point-forecast/docs).

예보 정확도는 과거 예보 이력이 보관되지 않아 산출하지 않습니다. 강수량은 API별 누적 기간이 달라 단순 차이를 계산하지 않으며, Windy Point Forecast는 강수확률 값을 제공하지 않습니다.

농작업 판단 탭에서 질문하면 현재 대시보드의 기상청 실황·예보와 모델 예보를 질문과 함께 Gemini API로 보내고, 답변을 화면에 표시합니다. 서버리스 인스턴스별로 요청 수를 제한하며, 제한은 인스턴스 간 공유되지 않는 최선 노력 방식입니다.

로컬에서 서버리스 API를 테스트하려면 Vercel CLI 개발 서버에서 `KMA_SERVICE_KEY`, `KMA_ASOS_SERVICE_KEY`(또는 ASOS 승인이 포함된 `KMA_SERVICE_KEY`), `WINDY_POINT_FORECAST_API_KEY`, `GEMINI_API_KEY` 환경변수를 설정하세요. Python 정적 서버는 `/api` 함수를 실행하지 않습니다.

실제 비밀 API 키를 브라우저 코드나 공개 저장소에 저장하지 마세요.
