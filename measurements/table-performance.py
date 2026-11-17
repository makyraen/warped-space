"""IV.3 Table 3: ranges over the six conditions of each browser, from performance-extended*.json.
Frame rate: lowest and highest round over all conditions; other metrics: lowest and highest condition value.
Rounding is half-up. Usage: python3 measurements/table-performance.py [results file name ...]"""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import json, sys

ROOT = Path(__file__).resolve().parent.parent

def q(x, nd):
    return str(Decimal(repr(x)).quantize(Decimal(1).scaleb(-nd), rounding=ROUND_HALF_UP))

def rng(lo, hi, nd, suffix=''):
    if lo is None:
        return '–'
    a, b = q(lo, nd), q(hi, nd)
    return (a if a == b else f'{a}~{b}') + suffix

def span(rows, f):
    v = [f(r) for r in rows if f(r) is not None]
    return (min(v), max(v)) if v else (None, None)

def table(name):
    d = json.loads((ROOT / 'measurements/results' / name).read_text(encoding='utf-8'))
    out = [f"{name}: {d['meta'].get('cpu', '').strip()} | {d['meta'].get('display', '')} | {d['meta'].get('platform')}"]
    targets = list(d['results'])
    out.append('| Metric | ' + ' | '.join(targets) + ' |')
    rows = {t: d['results'][t]['rows'] for t in targets}
    def line(label, cell):
        out.append(f'| {label} | ' + ' | '.join(cell(rows[t]) for t in targets) + ' |')
    def fps(rs):
        lo, hi = min(r['fpsMinRound'] for r in rs), max(r['fpsMaxRound'] for r in rs)
        return rng(lo, hi, 0 if hi > 100 else 1)
    line('Frame rate (fps)', fps)
    line('Frame interval, mean (ms)', lambda rs: rng(*span(rs, lambda r: r['intervalMeanMs']), 2))
    line('Frame interval, SD (ms)', lambda rs: rng(*span(rs, lambda r: r['intervalSdMs']), 2))
    line('Frame interval, p99 (ms)', lambda rs: rng(*span(rs, lambda r: r['intervalP99Ms']), 1))
    line('Late frames (> 1.5 × median)', lambda rs: rng(*span(rs, lambda r: 100 * r['lateFrameFraction']), 0, '%'))
    line('Processing time, mean (ms)', lambda rs: rng(*span(rs, lambda r: r['cbMeanMs']), 2))
    line('Processing time, SD (ms)', lambda rs: rng(*span(rs, lambda r: r['cbSdMs']), 2))
    line('GPU time, mean (ms)', lambda rs: rng(*span(rs, lambda r: r['gpuMeanMs']), 2))
    line('Browser CPU (% of one core)', lambda rs: rng(*span(rs, lambda r: r['browserCpuPercent']), 0))
    line('System GPU utilization (%)', lambda rs: rng(*span(rs, lambda r: r['gpuUtilPercent']), 0))
    line('Main-thread busy (%)', lambda rs: rng(*span(rs, lambda r: r['mainThreadBusyPercent']), 0))
    for t in targets:
        env = d['results'][t]['env']
        out.append(f"{t}: {env.get('renderer', '')} | {env.get('userAgent', '')[-45:]}")
    return '\n'.join(out)

for name in (sys.argv[1:] or ['performance-extended.json', 'performance-extended-windows.json']):
    print(table(name)); print()
