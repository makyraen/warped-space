// Peak relative energy error of semi-implicit Euler and KDK in the Newtonian mode (IV.1).
// Forces come from the app's computeAcceleration(); only the stepping differs.

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
    const { state, CONFIG, computeAcceleration, createMass } = window.__warped;
    const Geff = CONFIG.gravityK * CONFIG.physicsSpeedScale;
    const eps = CONFIG.epsilon;

    const M0 = 200, M1 = 20;
    createMass({ x: 0, z: 0 }, 45, M0);
    createMass({ x: 250, z: 0 }, 9, M1);
    const c = state.masses[0], s = state.masses[1];
    for (const m of [c, s]) { m.growth = 1; m.settling = false; m.geo = null; }

    const R0 = 250, VT = 40;
    function reset() {
        c.mesh.position.set(0, 0, 0); c.velocity.set(0, 0, 0);
        s.mesh.position.set(R0, 0, 0); s.velocity.set(0, 0, VT);
    }

    function energy() {
        const dx = s.mesh.position.x - c.mesh.position.x;
        const dz = s.mesh.position.z - c.mesh.position.z;
        const r = Math.hypot(dx, dz);
        const v2 = s.velocity.x ** 2 + s.velocity.z ** 2;
        return { E: 0.5 * M1 * v2 - Geff * M0 * M1 / Math.sqrt(r * r + eps * eps), r };
    }

    function stepEuler(dt) {
        const a = computeAcceleration(1);
        s.velocity.x += a.ax * dt; s.velocity.z += a.az * dt;
        s.mesh.position.x += s.velocity.x * dt; s.mesh.position.z += s.velocity.z * dt;
    }
    // kick-drift-kick
    function stepLeapfrog(dt) {
        let a = computeAcceleration(1);
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
        s.mesh.position.x += s.velocity.x * dt; s.mesh.position.z += s.velocity.z * dt;
        a = computeAcceleration(1);
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
    }

    function makeRng(seed) {
        let x = seed >>> 0;
        return () => (x = (1103515245 * x + 12345) >>> 0) / 4294967296;
    }

    function run(stepFn, dtBase, steps, jitter) {
        reset();
        const rng = makeRng(12345);
        const E0 = energy().E;
        let maxRel = 0, rMin = Infinity, rMax = 0;
        const series = [];
        let t = 0;
        for (let i = 0; i < steps; i++) {
            const dt = jitter ? dtBase * (0.5 + rng()) : dtBase;
            stepFn(dt);
            t += dt;
            const { E, r } = energy();
            if (!Number.isFinite(E) || !Number.isFinite(r)) {
                return { diverged: true, atStep: i, E0, maxRel, rMin, rMax, series };
            }
            const rel = Math.abs((E - E0) / E0);
            if (rel > maxRel) maxRel = rel;
            if (r < rMin) rMin = r;
            if (r > rMax) rMax = r;
            if (i % 50 === 0) series.push({ t: +t.toFixed(3), rel: +rel.toPrecision(6), r: +r.toFixed(2) });
        }
        const n = series.length;
        const mt = series.reduce((a, p) => a + p.t, 0) / n;
        const mr = series.reduce((a, p) => a + p.rel, 0) / n;
        let num = 0, den = 0;
        for (const p of series) { num += (p.t - mt) * (p.rel - mr); den += (p.t - mt) ** 2; }
        return { diverged: false, E0, maxRel, rMin, rMax, slopePerUnitTime: num / den, series };
    }

    const dt = CONFIG.physicsTimeStep;
    const STEPS = 24000;
    return {
        meta: { Geff, eps, M0, M1, R0, VT, dt, steps: STEPS },
        eulerFixed:    run(stepEuler,    dt, STEPS, false),
        leapfrogFixed: run(stepLeapfrog, dt, STEPS, false),
        eulerJitter:   run(stepEuler,    dt, STEPS, true),
        leapfrogJitter:run(stepLeapfrog, dt, STEPS, true),
    };
});

await browser.close();

const fmt = (v) => (v * 100).toExponential(3) + '%';
console.log('Settings:', JSON.stringify(result.meta));
console.log('');
for (const [k, label] of [
    ['eulerFixed', 'semi-implicit Euler, fixed step'],
    ['leapfrogFixed', 'kick-drift-kick, fixed step'],
    ['eulerJitter', 'semi-implicit Euler, jittered step (±50%)'],
    ['leapfrogJitter', 'kick-drift-kick, jittered step (±50%)'],
]) {
    const r = result[k];
    if (r.diverged) { console.log(`${label}: diverged (step ${r.atStep})`); continue; }
    console.log(`${label}`);
    console.log(`   max |dE/E0| = ${fmt(r.maxRel)}`);
    console.log(`   secular drift slope = ${r.slopePerUnitTime.toExponential(3)} per unit time`);
    console.log(`   r range = ${r.rMin.toFixed(2)} ~ ${r.rMax.toFixed(2)}`);
}
if (errs.length) console.log('\npageerrors:', JSON.stringify(errs));

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/energy_drift.json', import.meta.url), JSON.stringify(result, null, 1));
console.log('\nSaved measurements/results/energy_drift.json');
