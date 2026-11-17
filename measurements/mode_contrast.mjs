// Orbits of the two modes from the same placement (IV.4, Table 4, Fig. 5).
// Each mode starts at r0 with 0.85 of its own circular value; the app's updateMassPhysics() is stepped directly.

import { chromium } from './browser-runtime.mjs';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const OUT = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const SECONDS = 120;
const R0 = 200;
const CENTER_MASS = 100, SAT_MASS = 100;
const K = 0.85;

const channel = process.env.WARPED_BROWSER_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ channel: channel || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(process.env.APP_URL || 'http://127.0.0.1:8777/index.html?debug', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__warped, null, { timeout: 20000 });
await page.waitForTimeout(500);

async function run(model, epsOverride) {
    await page.evaluate(() => document.getElementById('btn-reset').click());
    await page.waitForTimeout(400);
    await page.evaluate((m) => {
        if (window.__warped.state.model !== m) document.getElementById('btn-toggle-model').click();
    }, model);
    await page.evaluate(({ r0, cm, sm }) => {
        const { createMass, massToScale } = window.__warped;
        createMass({ x: 0, z: 0 }, massToScale(cm), cm);
        createMass({ x: r0, z: 0 }, massToScale(sm), sm);
    }, { r0: R0, cm: CENTER_MASS, sm: SAT_MASS });

    await page.waitForTimeout(2200);

    return await page.evaluate(({ r0, seconds, k, epsOverride }) => {
        const W = window.__warped;
        const { state, CONFIG, updateMassPhysics } = W;
        const sat = state.masses[1], center = state.masses[0];
        const epsSaved = CONFIG.epsilon;
        if (epsOverride != null) CONFIG.epsilon = epsOverride;

        sat.mesh.position.set(r0, sat.mesh.position.y, 0);
        let ic;
        if (state.model === 'FLAMM') {
            const M = center.mass * center.growth * CONFIG.massToM;
            const rs = Math.max(r0, CONFIG.geodesicMinRFactor * M);
            const Lcirc = Math.sqrt(M * rs * rs / (rs - 3 * M));
            sat.geo = { r: r0, phi: 0, vr: 0, L: Lcirc * k };
            ic = { Lcirc: +Lcirc.toFixed(4), L: +(Lcirc * k).toFixed(4), M: +M.toFixed(4) };
        } else {
            const a = W.computeAcceleration(1);
            const ar = -(a.ax * (sat.mesh.position.x / r0) + a.az * (sat.mesh.position.z / r0));
            const vc = Math.sqrt(Math.max(ar, 0) * r0);
            sat.velocity.set(0, 0, vc * k);
            ic = { vCirc: +vc.toFixed(4), v: +(vc * k).toFixed(4) };
        }

        const dt = CONFIG.physicsTimeStep;
        const steps = Math.round(seconds / dt);
        const rs = [], phis = [], ts = [];
        let hitWall = false;
        for (let i = 0; i < steps; i++) {
            updateMassPhysics(dt);
            const x = sat.mesh.position.x - center.mesh.position.x;
            const z = sat.mesh.position.z - center.mesh.position.z;
            const rr = Math.hypot(x, z);
            if (rr >= CONFIG.massLimit - 0.5) hitWall = true;
            rs.push(rr); phis.push(Math.atan2(z, x)); ts.push((i + 1) * dt);
        }
        const eps = CONFIG.epsilon;
        CONFIG.epsilon = epsSaved;
        return { model: state.model, dt, steps, rs, phis, ts, hitWall, ic, eps, massLimit: CONFIG.massLimit };
    }, { r0: R0, seconds: SECONDS, k: K, epsOverride });
}

function unwrap(phis) {
    const out = [phis[0]]; let acc = phis[0];
    for (let i = 1; i < phis.length; i++) {
        let d = phis[i] - phis[i - 1];
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        acc += d; out.push(acc);
    }
    return out;
}
function apsides(rs, phiU, ts, sign) {
    const out = [];
    for (let i = 1; i < rs.length - 1; i++) {
        const a = rs[i - 1], b = rs[i], c = rs[i + 1];
        const isExt = sign > 0 ? (b < a && b <= c) : (b > a && b >= c);
        if (!isExt) continue;
        const den = a - 2 * b + c;
        const off = den !== 0 ? 0.5 * (a - c) / den : 0;      // [-0.5, 0.5]
        const lerp = (arr) => arr[i] + off * (off > 0 ? arr[i + 1] - arr[i] : arr[i] - arr[i - 1]);
        out.push({ r: b - 0.25 * (a - c) * off, phi: lerp(phiU), t: lerp(ts) });
    }
    return out;
}
function metrics(run) {
    const phiU = unwrap(run.phis);
    const peri = apsides(run.rs, phiU, run.ts, +1);
    const apo = apsides(run.rs, phiU, run.ts, -1);
    const D = 180 / Math.PI;
    const advances = [], periods = [];
    for (let i = 1; i < peri.length; i++) {
        advances.push((peri[i].phi - peri[i - 1].phi - 2 * Math.PI) * D);
        periods.push(peri[i].t - peri[i - 1].t);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const rMin = Math.min(...run.rs), rMax = Math.max(...run.rs);
    return {
        model: run.model, epsilon: run.eps, initialConditions: run.ic, hitBoundary: run.hitWall,
        rMin: +rMin.toFixed(2), rMax: +rMax.toFixed(2),
        radialExcursion: +((rMax - rMin) / (rMax + rMin)).toFixed(4),
        radialPeriod: +mean(periods).toFixed(3),
        periapsisCount: peri.length, apoapsisCount: apo.length,
        precessionPerRadialPeriodDeg: +mean(advances).toFixed(4),
        precessionSpreadDeg: advances.length > 1
            ? +(Math.max(...advances) - Math.min(...advances)).toFixed(5) : null,
        closed: Math.abs(mean(advances)) < 1.0,
        firstPeriapsisPhiDeg: peri.length ? +(peri[0].phi * D).toFixed(2) : null,
    };
}

const out = {};
for (const m of ['RUBBER', 'FLAMM']) {
    const r = await run(m);
    out[m] = { raw: { dt: r.dt, steps: r.steps, seconds: SECONDS }, ...metrics(r) };
    out[m].track = r.rs.map((v, i) => (i % 10 === 0
        ? { t: +r.ts[i].toFixed(2), r: +v.toFixed(2), phi: +r.phis[i].toFixed(4) } : null)).filter(Boolean);
    const o = out[m];
    console.log(`\n== ${m}`);
    console.log(`   r range       : ${o.rMin} ~ ${o.rMax}   (excursion ${o.radialExcursion})`);
    console.log(`   radial period : ${o.radialPeriod}   periapses ${o.periapsisCount}`);
    console.log(`   precession    : ${o.precessionPerRadialPeriodDeg}° per period  (spread ${o.precessionSpreadDeg}°)`);
    console.log(`   closed        : ${o.closed}${o.hitBoundary ? '   (touched the boundary)' : ''}`);
    console.log(`   initial state : ${JSON.stringify(o.initialConditions)}`);
}

console.log('\n== Softening check (Newtonian mode)');
const sweep = [];
for (const e of [80, 40, 20, 10, 5, 2, 0]) {
    const r = await run('RUBBER', e);
    const m = metrics(r);
    sweep.push({ epsilon: e, precessionDeg: m.precessionPerRadialPeriodDeg,
                 rMin: m.rMin, rMax: m.rMax, radialPeriod: m.radialPeriod });
    console.log(`   eps=${String(e).padStart(2)}: precession ${m.precessionPerRadialPeriodDeg}°  (r ${m.rMin}~${m.rMax})`);
}
out.rubberEpsilonSweep = sweep;

writeFileSync(OUT + 'mode_contrast.json', JSON.stringify({ meta: { SECONDS, R0, CENTER_MASS, SAT_MASS, K }, ...out }, null, 1));
console.log(`\nSaved ${OUT}mode_contrast.json`);
console.log('Console errors:', errs.length, errs.slice(0, 3));
await browser.close();
