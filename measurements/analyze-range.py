"""Independent Darwin-parameter reference for range-trajectories.json (same method as analyze-reference.py)."""
from pathlib import Path
import json, platform
import numpy as np
import scipy
from scipy.integrate import solve_ivp, quad

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'measurements/results/range-validation.json'

data = json.loads((ROOT / 'measurements/results/range-trajectories.json').read_text(encoding='utf-8'))
hC = data['meta']['hCoarse']; h0 = data['meta']['h0']
summary = []
for case in data['cases']:
    M, p, e, L = (case[k] for k in ('M', 'p', 'e', 'L'))
    q = M / p
    times = np.asarray(case['sampleSteps'], dtype=float) * hC
    scale = p**1.5 / M**0.5 * (1 - (3 + e * e) * q)**0.5
    def tau_prime(chi):
        c = np.cos(chi)
        return scale / ((1 + e * c)**2 * np.sqrt(1 - (6 + 2 * e * c) * q))
    def rhs(t, y):
        r = p / (1 + e * np.cos(y[0]))
        return [1 / tau_prime(y[0]), L / (r * r)]
    period = quad(tau_prime, 0, 2 * np.pi, epsabs=1e-9, epsrel=5e-14, limit=200)[0]
    precession = quad(lambda chi: 1 / np.sqrt(1 - (6 + 2 * e * np.cos(chi)) * q), 0, 2 * np.pi, epsabs=1e-12, epsrel=5e-14, limit=200)[0] - 2 * np.pi
    sols = []
    for tol, frac in [(2e-12, 1 / 160), (4e-14, 1 / 320)]:
        sol = solve_ivp(rhs, (0, times[-1]), [0., 0.], method='DOP853', rtol=tol, atol=tol / 10, max_step=period * frac, t_eval=times)
        if not sol.success: raise RuntimeError(sol.message)
        r = p / (1 + e * np.cos(sol.y[0])); phi = sol.y[1]
        sols.append(np.column_stack([r * np.cos(phi), r * np.sin(phi)]))
    ref_xy = sols[1]
    ref_change = float(np.max(np.linalg.norm(sols[0] - ref_xy, axis=1)) / p)
    rows = []
    for run in case['runs']:
        s = np.asarray(run['samples'])
        if len(s) != len(times):
            rows.append({k: run[k] for k in ('divisor', 'h', 'stepsPerPeriod', 'maxEnergyRelative', 'minR', 'maxR', 'boundary', 'finite')} | {'maxPositionErrorOverP': None})
            continue
        xy = np.column_stack([s[:, 0] * np.cos(s[:, 1]), s[:, 0] * np.sin(s[:, 1])])
        err = np.linalg.norm(xy - ref_xy, axis=1) / p
        rows.append({k: run[k] for k in ('divisor', 'h', 'stepsPerPeriod', 'maxEnergyRelative', 'minR', 'maxR', 'boundary', 'finite')}
                    | {'maxPositionErrorOverP': float(np.max(err))})
    # order over Δτ0 … Δτ0/8 (as in Table 5 / Fig. 6)
    fit = [r for r in rows if r['h'] <= h0 * 1.0001 and r['maxPositionErrorOverP']]
    order = float(np.polyfit(np.log([r['h'] for r in fit]), np.log([r['maxPositionErrorOverP'] for r in fit]), 1)[0]) if len(fit) >= 3 else None
    at = lambda h: next(r for r in rows if abs(r['h'] - h) < 1e-9)
    summary.append({**{k: case[k] for k in ('id', 'group', 'delta', 'M', 'p', 'e', 'rp', 'ra', 'L', 'E2', 'pSep')},
                    'period': period, 'exactPrecessionDeg': float(np.degrees(precession)),
                    'referenceRefinementMaxPositionOverP': ref_change, 'sampleCount': len(times), 'order': order,
                    'EposDefault': at(h0)['maxPositionErrorOverP'], 'EposDouble': at(2 * h0)['maxPositionErrorOverP'],
                    'energyRelDefault': at(h0)['maxEnergyRelative'], 'stepsPerPeriodDefault': at(h0)['stepsPerPeriod'],
                    'anyBoundary': any(r['boundary'] for r in rows), 'runs': rows})
    c = summary[-1]
    print(f"{c['id']:<22} Δ={c['delta']:7.2f}  prec={c['exactPrecessionDeg']:9.2f}°  steps/T={c['stepsPerPeriodDefault']:7.0f}  "
          f"Epos(Δτ0)={c['EposDefault']:.2e}  Epos(2Δτ0)={c['EposDouble']:.2e}  order={c['order']:.3f}  dE²={c['energyRelDefault']:.1e}  ref={ref_change:.0e}"
          + ('  BOUNDARY' if c['anyBoundary'] else ''))
result = {'meta': {**data['meta'], 'reference': 'Darwin anomaly DOP853 in proper time (as analyze-reference.py)',
                   'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__}, 'cases': summary}
OUT.write_text(json.dumps(result, indent=2), encoding='utf-8')
