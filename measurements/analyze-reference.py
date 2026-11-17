"""Independent Darwin-parameter reference; does not use the app radial acceleration."""
from pathlib import Path
import json, platform, sys
import numpy as np
import scipy
from scipy.integrate import solve_ivp, quad
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import NullFormatter, NullLocator

ROOT=Path(__file__).resolve().parent.parent
# --plot-only redraws the figure from the saved reference-validation.json without recomputing.
PLOT_ONLY='--plot-only' in sys.argv
if PLOT_ONLY:
    result=json.loads((ROOT/'measurements/results/reference-validation.json').read_text(encoding='utf-8'))
    summary=result['cases']
else:
    data=json.loads((ROOT/'measurements/results/reference-trajectories.json').read_text(encoding='utf-8'))
    summary=[]
    examples={}
    for case in data['cases']:
        M,p,e,L=(case[k] for k in ('M','p','e','L'))
        q=M/p
        times=np.asarray(case['sampleSteps'],dtype=float)*data['meta']['h0']
        # r(chi)=p/(1+e*cos(chi)); dphi/dchi and dtau/dchi follow
        # the exact turning-point parameterization, not the reduced radial ODE.
        scale=p**1.5/M**0.5*(1-(3+e*e)*q)**0.5
        def tau_prime(chi):
            c=np.cos(chi)
            return scale/((1+e*c)**2*np.sqrt(1-(6+2*e*c)*q))
        def rhs(t,y):
            chi=y[0]
            r=p/(1+e*np.cos(chi))
            return [1/tau_prime(chi),L/(r*r)]
        period=quad(tau_prime,0,2*np.pi,epsabs=1e-9,epsrel=5e-14)[0]
        exact_precession=quad(lambda chi:1/np.sqrt(1-(6+2*e*np.cos(chi))*q),0,2*np.pi,epsabs=1e-12,epsrel=5e-14)[0]-2*np.pi
        solutions=[]
        for tol,step_fraction in [(2e-12,1/160),(4e-14,1/320)]:
            sol=solve_ivp(rhs,(0,times[-1]),[0.,0.],method='DOP853',rtol=tol,atol=tol/10,max_step=period*step_fraction,t_eval=times)
            if not sol.success: raise RuntimeError(sol.message)
            r=p/(1+e*np.cos(sol.y[0]));phi=sol.y[1]
            xy=np.column_stack([r*np.cos(phi),r*np.sin(phi)])
            solutions.append((r,phi,xy))
        ref_r,ref_phi,ref_xy=solutions[1]
        ref_change=float(np.max(np.linalg.norm(solutions[0][2]-ref_xy,axis=1))/p)
        rows=[]
        for run in case['runs']:
            samples=np.asarray(run['samples'])
            r,phi=samples[:,0],samples[:,1]
            xy=np.column_stack([r*np.cos(phi),r*np.sin(phi)])
            errors=np.linalg.norm(xy-ref_xy,axis=1)/p
            row={k:run[k] for k in ('angleRule','divisor','h','maxEnergyRelative','minR','maxR')}
            row.update(maxPositionErrorOverP=float(np.max(errors)),rmsPositionErrorOverP=float(np.sqrt(np.mean(errors**2))),maxRadialErrorOverP=float(np.max(np.abs(r-ref_r))/p),maxAngleErrorRad=float(np.max(np.abs(phi-ref_phi))))
            rows.append(row)
            if case['id']=='M10-e0.6' and run['divisor']==1:
                examples[run['angleRule']]=(times/period,errors)
        orders={}
        for method in ('right-endpoint','trapezoid'):
            selected=[r for r in rows if r['angleRule']==method]
            orders[method]=float(np.polyfit(np.log([r['h'] for r in selected]),np.log([r['maxPositionErrorOverP'] for r in selected]),1)[0])
        summary.append({**{k:case[k] for k in ('id','M','p','e','rp','ra','L','E2')},'period':period,'exactPrecessionRad':exact_precession,'referenceRefinementMaxPositionOverP':ref_change,'sampleCount':len(times),'duration':float(times[-1]),'orders':orders,'runs':rows})
        print(case['id'], 'orders',orders,'reference refinement',ref_change)

    result={'meta':{**data['meta'],'reference':'Darwin anomaly DOP853 in proper time, with independent quadrature for period and precession','python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__,'referenceTolerances':[2e-12,4e-14],'referenceMaxStepFractions':[1/160,1/320]},'cases':summary}
    (ROOT/'measurements/results/reference-validation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
h0=result['meta']['h0']
plt.rcParams.update({'font.size':7.5,'axes.spines.top':False,'axes.spines.right':False,'savefig.dpi':400})
# Step refinement for three representative orbits (smallest, middle, largest error); Table 5 lists all nine.
# Method = colour + line style (Right-endpoint: red dashed, Trapezoidal: blue solid); condition = marker.
# Drawn at the printed column width (80 mm): font sizes are printed sizes.
fig,ax=plt.subplots(figsize=(3.15,2.9),layout='constrained')
colors={'right-endpoint':'#ba493f','trapezoid':'#167a9b'}
styles={'right-endpoint':'--','trapezoid':'-'}
labels={'right-endpoint':'Right-endpoint (1st order)','trapezoid':'Trapezoidal (2nd order)'}
shown={'M1-e0.1':('o','M=1, e=0.1'),'M5-e0.3':('s','M=5, e=0.3'),'M10-e0.6':('^','M=10, e=0.6')}
for method in colors:
    for c in summary:
        if c['id'] not in shown: continue
        rr=[r for r in c['runs'] if r['angleRule']==method]
        ax.loglog([r['h'] for r in rr],[r['maxPositionErrorOverP'] for r in rr],ls=styles[method],marker=shown[c['id']][0],color=colors[method],ms=4.5,lw=1.2,mfc='white' if method=='right-endpoint' else colors[method],mew=1.0)
# reference slopes 1 and 2 in the empty corners: slope 1 upper left (above the right-endpoint lines),
# slope 2 lower right (below the trapezoidal lines)
for x0,x1,y0,k,lab in [(h0/8,h0/4,2e-2,1,'slope 1'),(h0/2,h0,1.2e-8,2,'slope 2')]:
    x=np.array([x0,x1])
    ax.loglog(x,y0*(x/x0)**k,color='#666666',lw=1.0,ls=':')
    ax.text(x1*1.08,y0*(x1/x0)**k,lab,fontsize=7.5,color='#555555',va='center')
handles=[]
for method in colors: handles.append(plt.Line2D([],[],color=colors[method],ls=styles[method],lw=1.2,label=labels[method]))
for cid,(mk,lab) in shown.items(): handles.append(plt.Line2D([],[],ls='none',marker=mk,color='#444444',ms=4.5,label=lab))
ax.set(xlabel=r'Proper-time step $\Delta\tau$ (geometric units, $G = c = 1$)',ylabel=r'Max. position error $E_{\mathrm{pos}}/p$')
ax.set_xticks([h0/8,h0/4,h0/2,h0],[r'$\Delta\tau_0/8$',r'$\Delta\tau_0/4$',r'$\Delta\tau_0/2$',r'$\Delta\tau_0$'])
ax.xaxis.set_minor_locator(NullLocator())  # only four step sizes; minor ticks between them carry no meaning
ax.set_yticks([10.0**k for k in range(-8,1)])
# y minor ticks (2..9 x 10^k) for reading the computed points, but none above 10^0 where the legend sits
ax.set_yticks([m*10.0**k for k in range(-9,0) for m in range(2,10) if m*10.0**k>=5e-9],minor=True)
ax.yaxis.set_minor_formatter(NullFormatter())
ax.grid(True,which='major',alpha=.2)
ax.set_xlim(h0/8/1.25,h0*1.25);ax.set_ylim(5e-9,8)
leg=ax.legend(handles=handles[:2],fontsize=7,loc='upper left',frameon=False,handlelength=1.8,handletextpad=0.4,borderaxespad=0.2)
ax.add_artist(leg)
ax.legend(handles=handles[2:],fontsize=7,loc='upper left',bbox_to_anchor=(0,0.875),ncol=3,frameon=False,handlelength=0.8,handletextpad=0.25,columnspacing=0.8,borderaxespad=0.2)
(ROOT / 'figure').mkdir(parents=True, exist_ok=True)
fig.savefig(ROOT/'figure/fig6_reference_validation.png')
fig.savefig(ROOT/'figure/fig6_reference_validation.svg')
plt.close(fig)
