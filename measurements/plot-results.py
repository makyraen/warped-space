from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parent.parent
(ROOT/'figure').mkdir(exist_ok=True)
DATA=ROOT/'measurements/results'
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'savefig.dpi':220})
# Fig. 5: the same on-screen configuration in both modes (IV.4, Table 4).
# The grey dashed ellipse is the common Kepler reference (no softening, no correction term, k = 0.85;
# measurements/common_ic.mjs): apoapsis at the start point, periapsis r0*k^2/(2-k^2), closed.
mode=json.loads((DATA/'mode_contrast.json').read_text(encoding='utf-8'))
plt.rcParams.update({'font.size':7.5})
# Drawn at the printed column width (80 mm): font sizes are printed sizes. (a) left of (b).
fig,axes=plt.subplots(1,2,figsize=(3.15,2.75),layout='constrained',sharey=True)
r0=mode['meta']['R0'];k=mode['meta']['K'];ek=1-k*k;pk=r0*(1-ek)
phk=np.linspace(0,2*np.pi,721);rk=pk/(1-ek*np.cos(phk))
for ax,(key,color,title) in zip(axes,[('RUBBER','#b65243','(a) Newtonian'),('FLAMM','#167a9b','(b) Schwarzschild')]):
    m=mode[key];tr=m['track'];r=np.array([v['r'] for v in tr]);ph=np.array([v['phi'] for v in tr])
    ax.add_patch(plt.Circle((0,0),r0,fill=False,color='#c3cad2',lw=.8,ls=(0,(2,3))))
    ax.plot(rk*np.cos(phk),rk*np.sin(phk),color='#8a8f96',lw=.9,ls='--',label='Kepler reference',zorder=2)
    # Only the first three radial periods (start is apoapsis), so the periapsis order stays readable.
    apo=np.where((r[1:-1]>r[:-2])&(r[1:-1]>=r[2:]))[0]+1
    n=apo[2]+1;r,ph=r[:n],ph[:n]
    ax.plot(r*np.cos(ph),r*np.sin(ph),color=color,lw=1.1,label='Orbit (3 periods)',zorder=3)
    k_=np.where((r[1:-1]<r[:-2])&(r[1:-1]<=r[2:]))[0]+1
    ax.scatter(r[k_]*np.cos(ph[k_]),r[k_]*np.sin(ph[k_]),s=10,color='#253748',zorder=5,label='Periapsis (in order)')
    for i,j in enumerate(k_,1):
        ax.annotate(str(i),(r[j]*np.cos(ph[j]),r[j]*np.sin(ph[j])),xytext=(1.3*r[j]*np.cos(ph[j]),1.3*r[j]*np.sin(ph[j])),ha='center',va='center',fontsize=8,fontweight='bold',color='#253748',zorder=6)
    ax.scatter([0],[0],s=20,color='#253748',zorder=5)
    ax.scatter([r0],[0],s=14,color='#253748',marker='s',zorder=6,label='Start')
    ax.annotate('',xy=(r0*np.cos(.3),r0*np.sin(.3)),xytext=(r0*np.cos(.08),r0*np.sin(.08)),arrowprops=dict(arrowstyle='-|>',color='#253748',lw=1.1,mutation_scale=9),zorder=6)
    ax.set(aspect='equal',xlim=(-225,225),ylim=(-225,225),xticks=[-200,0,200],yticks=[-200,0,200],xlabel='x (display units)',title=f"{title}\n{m['precessionPerRadialPeriodDeg']:+.2f}° per period".replace('-','\u2212'))
    ax.grid(alpha=.12)
axes[0].set_ylabel('y (display units)')
h,l=axes[0].get_legend_handles_labels();h[1]=plt.Line2D([],[],color='#555555',lw=1.1)
fig.legend(h,l,loc='outside lower center',ncol=2,fontsize=7.5,frameon=False,columnspacing=1.0,handlelength=1.6,handletextpad=0.4)
fig.savefig(ROOT/'figure/fig5_mode_comparison.png',dpi=400);fig.savefig(ROOT/'figure/fig5_mode_comparison.svg');plt.close(fig)
