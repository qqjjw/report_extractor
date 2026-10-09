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

보고서 목록은 `data/reports.json`에서 수정합니다. 검색 버튼 옆에서 `기존 규칙` 또는 `Laya choice`를 선택합니다. 기본값은 기존 규칙이며 Python을 실행하지 않습니다. Laya choice는 단계마다 후보 중 하나를 반드시 선택합니다. Python·모델 경로와 제한 시간은 `data/laya-config.json`에서 관리합니다.

앱 루트는 Electron 진입점 위치를 기준으로 계산합니다. 데이터·캐시·진단 결과는 앱 루트에 두고, 모듈과 화면 자원은 각 소스 파일을 기준으로 참조합니다. 보고서용 preload는 샌드박스에서 실행할 수 있도록 시작 시 번들로 생성합니다.

`npm test`는 규칙 및 choice 흐름의 JavaScript 회귀 테스트를 실행합니다. `python tests/laya_worker_test.py`는 모델을 로드하지 않고 Python 워커의 입력 한도와 단일 choice 호출을 검증합니다. 실제 모델 테스트 결과와 제한 사항은 `laya-choice-plan.md`에 기록합니다.
