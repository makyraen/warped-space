"""IV.3 Fig. 4: distribution of frame intervals and per-frame processing time on two PCs,
from performance-extended.json (PC 1, macOS) and performance-extended-windows.json (PC 2, Windows)."""
from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
def load(name):
    return json.loads((ROOT / 'measurements/results' / name).read_text(encoding='utf-8'))['results']

PCS = [
    ('PC 1 (macOS)', load('performance-extended.json'),
     [('chrome', 'Chrome', '#167a9b'), ('firefox', 'Firefox', '#d08c2f'), ('webkit', 'Safari (WebKit)', '#7a5195')], 75),
    ('PC 2 (Windows)', load('performance-extended-windows.json'),
     [('chrome', 'Chrome', '#167a9b'), ('edge', 'Edge', '#2e8b57'), ('firefox', 'Firefox', '#d08c2f')], 60),
]
conds = [('RUBBER', 1), ('RUBBER', 3), ('RUBBER', 5), ('FLAMM', 1), ('FLAMM', 3), ('FLAMM', 5)]
labels = ['N1', 'N3', 'N5', 'S1', 'S3', 'S5']

plt.rcParams.update({'font.size': 7.5, 'axes.spines.top': False, 'axes.spines.right': False, 'savefig.dpi': 400,
                     'axes.titlesize': 8, 'axes.labelsize': 7.5, 'xtick.labelsize': 7.5, 'ytick.labelsize': 7.5})
# Drawn at the printed column width (80 mm), so font sizes are the printed sizes (7.5 pt or more).
# Panels (a)-(d) stacked; (b) is flat at 60 Hz, so it gets a short panel with its own range.
fig, grid = plt.subplots(4, 1, figsize=(3.15, 5.9), layout='constrained', sharex=True,
                         gridspec_kw=dict(height_ratios=[1.35, 0.7, 1, 1]))
axes = [[grid[0], grid[1]], [grid[2], grid[3]]]
grid[3].sharey(grid[2])
width = 0.26
# Top: frame-interval distribution (box: quartiles, whiskers: 1st-99th percentile, diamond: mean).
# Bottom: per-frame processing time as mean +/- SD (Firefox and WebKit report performance.now() at coarse
# resolution, so only means are comparable across browsers); GPU time from WebGL timer queries (Chromium only).
legend = {}
for col, (pc, data, browsers, hz) in enumerate(PCS):
    top, bot = axes[0][col], axes[1][col]
    for k, (key, name, color) in enumerate(browsers):
        runs = data[key]['runs']
        pos = np.arange(len(conds)) + (k - 1) * width
        series = [np.concatenate([r['intervals'] for r in runs if r['model'] == m and r['count'] == c]) for m, c in conds]
        top.boxplot(series, positions=pos, widths=width * 0.85, whis=(1, 99), showfliers=False, patch_artist=True,
                    medianprops=dict(color='black', lw=1.0), boxprops=dict(facecolor=color, alpha=.55, edgecolor=color),
                    whiskerprops=dict(color=color), capprops=dict(color=color))
        top.scatter(pos, [x.mean() for x in series], marker='D', s=7, color='black', zorder=4)
        cb = [np.concatenate([r['callbacks'] for r in runs if r['model'] == m and r['count'] == c]) for m, c in conds]
        bot.bar(pos, [x.mean() for x in cb], width * 0.85, yerr=[x.std(ddof=1) for x in cb], color=color, alpha=.6,
                edgecolor=color, error_kw=dict(ecolor='#444444', lw=.8, capsize=2))
        if key in ('chrome', 'edge'):
            g = [np.median([r['gpuMeanMs'] for r in runs if r['model'] == m and r['count'] == c]) for m, c in conds]
            bot.scatter(pos, g, marker='^', s=14, color='#0b3d52', zorder=4)
        legend.setdefault(name, color)
    for f in ((75, 60) if col == 0 else (60,)):
        top.axhline(1000 / f, color='#888888', lw=.8, ls=':')
        top.text(-0.95, 1000 / f, f'{f} Hz', fontsize=7, color='#555555', va='bottom', ha='left')
    if col == 1:
        top.set_ylim(16.0, 17.4)
    top.set_title(f'({"ab"[col]}) Frame interval, {pc}', loc='left')
    bot.set_title(f'({"cd"[col]}) Processing time, {pc}', loc='left')
    top.set(ylabel='Interval (ms)')
    bot.set(ylabel='Time (ms)')
    bot.set_xticks(range(len(conds)), labels)
    bot.set_xlim(-1.0, 5.5)
    for ax in (top, bot):
        ax.grid(axis='y', alpha=.2)
grid[3].set_xlabel('Mode and number of bodies\n(N: Newtonian, S: Schwarzschild)', )
order = ['Chrome', 'Edge', 'Firefox', 'Safari (WebKit)']
handles = [plt.Line2D([], [], color=legend[n], lw=6, alpha=.55, label=n) for n in order]
handles += [plt.Line2D([], [], ls='none', marker='D', ms=4, color='black', label='Mean interval'),
            plt.Line2D([], [], ls='none', marker='^', ms=5, color='#0b3d52', label='GPU time (Chrome, Edge)')]
fig.legend(handles=handles, loc='outside upper center', ncol=2, fontsize=7.5, frameon=False, columnspacing=1.2, handlelength=1.4)
(ROOT / 'figure').mkdir(parents=True, exist_ok=True)
fig.savefig(ROOT / 'figure/fig4_performance.png')
fig.savefig(ROOT / 'figure/fig4_performance.svg')
plt.close(fig)
print('figure/fig4_performance.png')
