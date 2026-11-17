// Convergence order of semi-implicit Euler and KDK in the Newtonian mode (IV.1):
// the step is halved three times and the slope of the peak relative energy error is fitted.

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
    function stepLeapfrog(dt) {
        let a = computeAcceleration(1);
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
        s.mesh.position.x += s.velocity.x * dt; s.mesh.position.z += s.velocity.z * dt;
        a = computeAcceleration(1);
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
    }

    function run(stepFn, dt, steps) {
        reset();
        const E0 = energy().E;
        let maxRel = 0;
        for (let i = 0; i < steps; i++) {
            stepFn(dt);
            const { E, r } = energy();
            if (!Number.isFinite(E) || !Number.isFinite(r)) return { diverged: true, atStep: i };
            const rel = Math.abs((E - E0) / E0);
            if (rel > maxRel) maxRel = rel;
        }
        return { diverged: false, maxRel };
    }

    const dt0 = CONFIG.physicsTimeStep;
    const steps0 = 24000;
    const levels = [1, 2, 4, 8].map(div => ({
        div, dt: dt0 / div, steps: Math.round(steps0 * div),
    }));

    const euler = levels.map(({ div, dt, steps }) => ({ div, dt, ...run(stepEuler, dt, steps) }));
    const leapfrog = levels.map(({ div, dt, steps }) => ({ div, dt, ...run(stepLeapfrog, dt, steps) }));

    function slope(rows) {
        const pts = rows.filter(r => !r.diverged && r.maxRel > 0).map(r => [Math.log(r.dt), Math.log(r.maxRel)]);
        const n = pts.length;
        const mx = pts.reduce((a, [x]) => a + x, 0) / n;
        const my = pts.reduce((a, [, y]) => a + y, 0) / n;
        let num = 0, den = 0;
        for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
        return num / den;
    }

    return { meta: { Geff, eps, M0, M1, R0, VT, dt0, steps0 }, euler, leapfrog, slopeEuler: slope(euler), slopeLeapfrog: slope(leapfrog) };
});

await browser.close();

console.log('Settings:', JSON.stringify(result.meta));
console.log('');
for (const [key, label] of [['euler', 'semi-implicit Euler'], ['leapfrog', 'kick-drift-kick']]) {
    console.log(label + ':');
    for (const r of result[key]) {
        console.log(`   Δt = Δt0/${r.div} (${r.dt.toFixed(6)})  max |dE/E0| = ${r.diverged ? 'diverged' : (r.maxRel * 100).toExponential(3) + '%'}`);
    }
}
console.log('');
console.log(`Log-log convergence slope: semi-implicit Euler = ${result.slopeEuler.toFixed(3)} (expected 1), kick-drift-kick = ${result.slopeLeapfrog.toFixed(3)} (expected 2)`);
if (errs.length) console.log('\npageerrors:', JSON.stringify(errs));

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/convergence.json', import.meta.url), JSON.stringify(result, null, 1));
console.log('\nSaved measurements/results/convergence.json');
