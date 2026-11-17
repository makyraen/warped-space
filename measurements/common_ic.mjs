// Common Kepler baseline (IV.4): M = 5, r0 = 200, dr/dtau = 0, L = 0.85 sqrt(M r0),
// integrated with and without the -3ML^2/r^4 term.

import { writeFileSync, mkdirSync } from 'fs';
import { advanceGeodesic } from '../physics/geodesic.mjs';

const M = 5, R0 = 200, K = 0.85;
const DTAU = 260 / 120, DISPLAY_DT = 1 / 120, SECONDS = 120;
const STEPS = Math.round(SECONDS / DISPLAY_DT);
const INNER = 2.5 * M, OUTER = 340;

function advanceKepler(g, dtau) {
    const acc = (r) => -M / (r * r) + g.L * g.L / (r * r * r);
    const rBefore = g.r;
    g.vr += acc(g.r) * dtau / 2;
    g.r += g.vr * dtau;
    g.phi += dtau * (g.L / (rBefore * rBefore) + g.L / (g.r * g.r)) / 2;
    g.vr += acc(g.r) * dtau / 2;
}

function run(L, withCorrection) {
    const g = { r: R0, phi: 0, vr: 0, L };
    const rs = [], phis = [], ts = [];
    let boundary = false;
    for (let i = 0; i < STEPS; i++) {
        if (withCorrection) {
            if (advanceGeodesic(g, M, DTAU, { innerRadius: INNER, outerRadius: OUTER })) boundary = true;
        } else advanceKepler(g, DTAU);
        rs.push(g.r); phis.push(g.phi); ts.push((i + 1) * DISPLAY_DT);
    }
    return { rs, phis, ts, boundary };
}

function metrics({ rs, phis, ts, boundary }) {
    const peri = [];
    for (let i = 1; i < rs.length - 1; i++) {
        const a = rs[i - 1], b = rs[i], c = rs[i + 1];
        if (!(b < a && b <= c)) continue;
        const den = a - 2 * b + c;
        const off = den !== 0 ? 0.5 * (a - c) / den : 0;
        const lerp = (arr) => arr[i] + off * (off > 0 ? arr[i + 1] - arr[i] : arr[i] - arr[i - 1]);
        peri.push({ phi: lerp(phis), t: lerp(ts) });
    }
    const D = 180 / Math.PI, mean = (x) => x.reduce((p, q) => p + q, 0) / (x.length || 1);
    const adv = [], per = [];
    for (let i = 1; i < peri.length; i++) {
        adv.push((peri[i].phi - peri[i - 1].phi - 2 * Math.PI) * D);
        per.push(peri[i].t - peri[i - 1].t);
    }
    const rMin = Math.min(...rs), rMax = Math.max(...rs);
    return {
        rMin: +rMin.toFixed(2), rMax: +rMax.toFixed(2),
        eccentricity: +((rMax - rMin) / (rMax + rMin)).toFixed(4),
        periodDisplay: +mean(per).toFixed(3), periodTau: +(mean(per) / DISPLAY_DT * DTAU).toFixed(1),
        precessionDeg: +mean(adv).toFixed(4), periapsisCount: peri.length, boundary,
    };
}

const Lnewt = K * Math.sqrt(M * R0);
const Lcirc = Math.sqrt(M * R0 * R0 / (R0 - 3 * M));
const Lschw = K * Lcirc;
const keplerTheory = { rMin: R0 * K * K / (2 - K * K), eccentricity: 1 - K * K };

const cases = {
    A_kepler: { L: Lnewt, correction: false, ...metrics(run(Lnewt, false)) },
    B_schwarzschildSameIC: { L: Lnewt, correction: true, ...metrics(run(Lnewt, true)) },
    C_schwarzschildMode: { L: Lschw, correction: true, ...metrics(run(Lschw, true)) },
    C_noCorrection: { L: Lschw, correction: false, ...metrics(run(Lschw, false)) },
};

console.log(`M=${M}, r0=${R0}, k=${K}, Δτ=${DTAU.toFixed(4)}, L_newt=${Lnewt.toFixed(4)}, L_circ(S)=${Lcirc.toFixed(4)}, L_schw=${Lschw.toFixed(4)}`);
console.log('Kepler theory:', JSON.stringify({ rMin: +keplerTheory.rMin.toFixed(2), e: +keplerTheory.eccentricity.toFixed(4) }));
for (const [k, v] of Object.entries(cases)) console.log(k.padEnd(24), JSON.stringify(v));

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/common_ic.json', import.meta.url),
    JSON.stringify({ meta: { M, R0, K, DTAU, SECONDS, Lnewt, Lcirc, Lschw, keplerTheory }, cases }, null, 1));
console.log('\nSaved measurements/results/common_ic.json');
