# Global Flight Pulse

전세계 비행기 현황을 지도에서 볼 수 있는 간단한 웹 앱입니다. 로컬 Node 서버가 OpenSky Network의 실시간 항공기 상태 데이터를 가져와 브라우저에 전달합니다.

## 실행 방법

```bash
cd /Users/choonsik/Documents/Codex/2026-04-17-new-chat/flight-radar-app
node server.js
```

브라우저에서 `http://localhost:3030` 을 열면 됩니다.

## 포함된 기능

- 전세계 항공기 위치 지도 표시
- 비행 중 / 지상 상태 구분
- 편명, 국가, ICAO24 기준 검색
- 항공사 / 편명 앞자리 필터
- 표시 개수 조절
- 자동 새로고침
- 현재 지도 범위 기준 데이터 갱신
- 선택 항공기 상세 패널
- 최근 이동 궤적 표시 및 길이 조절
- 추정 출발 / 도착 공항 표시
- 항공기 선택 고정
- 저배율 지도 군집 표시
- 인천 / 김포 / 김해 / 제주 공항 프리셋
- 현재 화면 기준 통계 패널

## 참고

- 실시간 데이터 제공처 상태나 요청 제한에 따라 일부 시점에는 응답이 느리거나 실패할 수 있습니다.
- 타일 지도는 OpenStreetMap, 항공기 상태 데이터는 OpenSky Network 기반입니다.

## Render 배포

이 프로젝트는 `render.yaml` 이 포함되어 있어서 Render에 Git 저장소만 연결하면 바로 배포할 수 있습니다.

1. GitHub에 이 폴더를 업로드합니다.
2. Render에서 `New +` → `Blueprint` 또는 `Web Service`를 선택합니다.
3. 저장소를 연결하면 `buildCommand`, `startCommand`, `healthCheckPath`가 자동으로 적용됩니다.
4. 배포가 끝나면 Render가 발급한 URL로 접속합니다.

### Airplanes.live 기본 사용

기본 공급원은 `airplanes.live` 입니다. 공식 가이드 기준으로 `point/{lat}/{lon}/{radius}` 엔드포인트를 사용하며, 반경은 최대 `250nm` 까지 지원됩니다.

### Aviationstack 사용

`LIVE_DATA_PROVIDER` 값을 바꾸고 `AVIATIONSTACK_ACCESS_KEY` 환경 변수를 설정하면 Aviationstack 실시간 항공편 API를 사용할 수 있습니다.

필요한 환경 변수:

```bash
LIVE_DATA_PROVIDER=aviationstack
AVIATIONSTACK_ACCESS_KEY=your_key_here
```

Render에서는 서비스 설정의 `Environment` 에서 같은 이름으로 추가하면 됩니다.
