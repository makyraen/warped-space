# 측정 재현

논문 III장과 IV장의 수치를 만든 스크립트와 원자료이다.

## 준비

이 폴더에서 처음 한 번:

```
npm ci
pip install -r requirements.txt
```

브라우저가 필요한 측정은 저장소 루트에서 `node serve.mjs`를 띄워 둔 채로 돌린다. 기본 브라우저는 Edge이고, Chrome을 쓰려면 `WARPED_BROWSER_CHANNEL=chrome`을 지정한다. 스크립트는 `?debug`로 연 앱의 물리 계산 함수를 그대로 호출한다.

## 명령

저장소 루트에서 실행한다.

| 논문 | 명령 |
|---|---|
| IV.1, IV.2, IV.4 (에너지 오차, 수렴, 세차, 두 모드 궤적) | `node measurements/run-regression.mjs` |
| IV.1 계산 비용을 맞춘 비교 | `node measurements/cost_accuracy.mjs` |
| IV.3 성능 (Table 3, Fig. 4) | `node measurements/performance-extended.mjs` |
| IV.4 공통 Kepler 기준 | `node measurements/common_ic.mjs` |
| IV.5 독립 기준해 비교 (Table 5, Fig. 6) | `node measurements/reference-validation.mjs` → `python measurements/analyze-reference.py` |
| IV.5 적용 범위 확장 (62개 궤도) | `node measurements/range-validation.mjs` → `python measurements/analyze-range.py` |
| III.4 배치 경계 보정 | `node measurements/placement_stability.mjs` |
| III.7 앱과 물리 모듈 일치 | `node measurements/app-smoke.mjs` |

`common_ic`, `reference-validation`, `range-validation`과 파이썬 분석은 서버 없이 돈다.

## 원자료

결과는 `results/`에 JSON으로 저장되고, 논문에 쓴 원자료도 그 자리에 들어 있다. 다시 돌리면 덮어쓰므로 원자료를 보존하려면 복사본에서 돌린다.

원자료만 점검하려면 서버 없이:

```
node measurements/verify-results.mjs --data-only
```

Schwarzschild 궤도 계산은 `physics/geodesic.mjs` 한 파일에 있고 앱과 측정 스크립트가 같이 쓴다. 원자료마다 이 파일의 SHA-256이 기록되어 있어 어떤 코드로 만든 값인지 확인할 수 있다.

## 그래프

`plot-results.py`, `plot-performance.py`, `analyze-reference.py --plot-only`가 루트의 `figure/`에 그린다. 파일 이름은 논문 그림 번호를 따른다(Fig. 4 `fig4_performance.png`, Fig. 5 `fig5_mode_comparison.png`, Fig. 6 `fig6_reference_validation.png`). `python measurements/table-performance.py`는 Table 3의 범위를 다시 계산한다.
