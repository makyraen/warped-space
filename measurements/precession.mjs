// Periapsis precession per radial period with and without the -3ML^2/r^4 term (IV.2).

import { chromium } from './browser-runtime.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8777/index.html?debug';

const channel = process.env.WARPED_BROWSER_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ channel: channel || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.goto(APP_URL, { waitUntil: 'load' });
await page.waitForTimeout(600);

const result = await page.evaluate(() => {
    const { CONFIG, geodesicRadialAccel } = window.__warped;

    function accel(r, L, M, includeGR) {
        const iR = 1 / r;
        let a = -M * iR * iR + L * L * iR * iR * iR;
        if (includeGR) a -= 3 * M * L * L * iR * iR * iR * iR;
        return a;
    }

    const agreement = [[150, 49.8, 10], [220, 14.2, 1], [300, 30, 5]].map(([r, L, M]) => {
        const app = geodesicRadialAccel(r, L, M), harness = accel(r, L, M, true);
        return { r, L, M, app, harness, relDiff: Math.abs((harness - app) / app) };
    });

    function integrate({ M, rPeri, kL, includeGR, dtau, orbits }) {
        const Lcirc = Math.sqrt(M * rPeri * rPeri / (rPeri - 3 * M));
        const L = Lcirc * kL;
        let r = rPeri, phi = 0, vr = 0, tau = 0;
        let rMin = r, rMax = r;
        const peri = [{ phi: 0, tau: 0 }];
        let pVr = vr, pPhi = phi, pTau = tau;
        const MAX = 6000000;
        for (let i = 0; i < MAX && peri.length < orbits + 1; i++) {
            const rBefore = r;
            vr += accel(r, L, M, includeGR) * dtau / 2;
            r += vr * dtau;
            phi += 0.5 * L * (1 / (rBefore * rBefore) + 1 / (r * r)) * dtau;
            vr += accel(r, L, M, includeGR) * dtau / 2;
            tau += dtau;
            if (!Number.isFinite(r) || r <= 0) return { diverged: true, atStep: i };
            if (r < rMin) rMin = r;
            if (r > rMax) rMax = r;
            if (pVr < 0 && vr >= 0) {
                const f = pVr / (pVr - vr);
                peri.push({ phi: pPhi + f * (phi - pPhi), tau: pTau + f * (tau - pTau) });
            }
            pVr = vr; pPhi = phi; pTau = tau;
        }
        if (peri.length < 2) return { insufficient: true, peri: peri.length, rMin, rMax };

        const perOrbit = [];
        for (let i = 1; i < peri.length; i++) perOrbit.push(peri[i].phi - peri[i - 1].phi - 2 * Math.PI);
        const mean = perOrbit.reduce((a, b) => a + b, 0) / perOrbit.length;
        const spread = Math.max(...perOrbit) - Math.min(...perOrbit);

        const a = (rMin + rMax) / 2;
        const e = (rMax - rMin) / (rMax + rMin);
        const p = a * (1 - e * e);
        const theory = 6 * Math.PI * M / p;
        return {
            M, L, rPeri, kL, includeGR, dtau, orbits: perOrbit.length,
            rMin, rMax, a, e, p, weakFieldParam: 2 * M / p,
            precessionPerOrbit: mean, spreadAcrossOrbits: spread,
            theoryWeakField: theory,
            period: peri.length > 1 ? peri[1].tau - peri[0].tau : null,
        };
    }

    const dtauApp = CONFIG.physicsTimeStep * CONFIG.geodesicTimeScale;

    return {
        meta: { dtauApp, physicsTimeStep: CONFIG.physicsTimeStep, geodesicTimeScale: CONFIG.geodesicTimeScale },
        agreement,
        weakGR:    integrate({ M: 1, rPeri: 150, kL: 1.15, includeGR: true,  dtau: dtauApp, orbits: 8 }),
        weakNewton:integrate({ M: 1, rPeri: 150, kL: 1.15, includeGR: false, dtau: dtauApp, orbits: 8 }),
        weakFine:  integrate({ M: 1, rPeri: 150, kL: 1.15, includeGR: true,  dtau: dtauApp / 8, orbits: 8 }),
        demoGR:    integrate({ M: 10, rPeri: 150, kL: 1.05, includeGR: true,  dtau: dtauApp, orbits: 6 }),
        demoNewton:integrate({ M: 10, rPeri: 150, kL: 1.05, includeGR: false, dtau: dtauApp, orbits: 6 }),
        demoFine:  integrate({ M: 10, rPeri: 150, kL: 1.05, includeGR: true,  dtau: dtauApp / 8, orbits: 6 }),
        mScaling: [1, 0.5, 0.25, 0.125].map(M =>
            integrate({ M, rPeri: 150, kL: 1.15, includeGR: true, dtau: dtauApp, orbits: 5 })),
    };
});

await browser.close();

const deg = (rad) => (rad * 180 / Math.PI);
function show(label, r) {
    if (!r || r.diverged) { console.log(`${label}: diverged`); return; }
    if (r.insufficient) { console.log(`${label}: too few periapses`); return; }
    console.log(`${label}`);
    console.log(`   M=${r.M}  L=${r.L.toFixed(3)}  r=${r.rMin.toFixed(1)}~${r.rMax.toFixed(1)}  e=${r.e.toFixed(4)}  p=${r.p.toFixed(1)}  2M/p=${r.weakFieldParam.toFixed(4)}`);
    console.log(`   measured per period = ${r.precessionPerOrbit.toExponential(4)} rad = ${deg(r.precessionPerOrbit).toFixed(4)}°   (spread across periods ${r.spreadAcrossOrbits.toExponential(2)})`);
    console.log(`   weak-field theory   = ${r.theoryWeakField.toExponential(4)} rad = ${deg(r.theoryWeakField).toFixed(4)}°`);
}

console.log('Settings:', JSON.stringify(result.meta));
console.log('\n=== Check: harness acceleration equals the app geodesicRadialAccel ===');
for (const a of result.agreement) console.log(`   r=${a.r} L=${a.L} M=${a.M}  relative difference ${a.relDiff.toExponential(2)}`);

console.log('\n=== 1. Weak field (M=1): comparison with the weak-field formula ===');
show('Correction on ', result.weakGR);
show('Correction off', result.weakNewton);
show('Correction on, dtau/8', result.weakFine);
if (result.weakGR?.precessionPerOrbit && result.weakGR?.theoryWeakField) {
    const err = Math.abs(result.weakGR.precessionPerOrbit - result.weakGR.theoryWeakField) / result.weakGR.theoryWeakField;
    console.log(`   error against the weak-field formula: ${(err * 100).toFixed(2)}%`);
}

console.log('\n=== 2. Display scale (M=10) ===');
show('Correction on ', result.demoGR);
show('Correction off', result.demoNewton);
show('Correction on, dtau/8', result.demoFine);
if (result.demoGR?.precessionPerOrbit && result.demoFine?.precessionPerOrbit) {
    const err = Math.abs(result.demoGR.precessionPerOrbit - result.demoFine.precessionPerOrbit) / Math.abs(result.demoFine.precessionPerOrbit);
    console.log(`   difference from the dtau/8 run: ${(err * 100).toFixed(3)}%`);
}
console.log('\n=== 3. Weak-field limit (decreasing M) ===');
console.log('   A residual that falls in proportion to M/p comes from higher-order terms; a constant residual would be an implementation error.');
console.log('   M       2M/p      meas.(°)    theory(°)   rel.err     err/(M/p)');
for (const r of result.mScaling) {
    if (!r || r.diverged || r.insufficient) { console.log('   (failed)'); continue; }
    const relErr = (r.precessionPerOrbit - r.theoryWeakField) / r.theoryWeakField;
    const MoverP = r.M / r.p;
    console.log(`   ${String(r.M).padEnd(7)} ${r.weakFieldParam.toFixed(5).padEnd(9)} ${deg(r.precessionPerOrbit).toFixed(4).padEnd(11)} ${deg(r.theoryWeakField).toFixed(4).padEnd(11)} ${(relErr * 100).toFixed(3).padStart(7)}%   ${(relErr / MoverP).toFixed(3)}`);
}

if (errs.length) console.log('\npageerrors:', JSON.stringify(errs));

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/precession.json', import.meta.url), JSON.stringify(result, null, 1));
console.log('\nSaved measurements/results/precession.json');
