# 보고서 캔버스

이 폴더에서 `npm start`로 실행합니다. 처음 설치할 때는 `npm install`을 먼저 실행합니다.

## 폴더 안내

| 폴더 | 역할 |
| --- | --- |
| `src/main` | Electron 진입점, preload, 보고서 프레임 이동, preload 번들 생성 |
| `src/renderer` | 화면 HTML, 화면 제어, 목차 패널, 표 검색 UI, CSS |
| `src/toc` | 목차 모델, 추출, 세션 관리 |
| `src/tables` | 표 검색, 규칙, DOM 분석, 파서와 워커 |
| `src/laya` | Laya 연결과 Python 워커 |
| `src/shared` | 보고서 모델과 비동기 작업 유틸리티 |
| `data` | 보고서 목록과 검색·Laya 설정 |
| `.runtime` | 실행 시 생성되는 Electron 캐시와 보고서용 preload 번들 |
| `artifacts` | `npm start -- --capture-on-load` 검증 결과가 생성되는 위치 |

보고서 목록은 `data/reports.json`에서 수정합니다. Laya 활성화 여부는 `data/laya-config.json`에서 관리하며, 현재는 비활성화 상태입니다.

앱 루트는 Electron 진입점 위치를 기준으로 계산합니다. 데이터·캐시·진단 결과는 앱 루트에 두고, 모듈과 화면 자원은 각 소스 파일을 기준으로 참조합니다. 보고서용 preload는 샌드박스에서 실행할 수 있도록 시작 시 번들로 생성합니다.
