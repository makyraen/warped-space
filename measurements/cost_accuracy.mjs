// Semi-implicit Euler and KDK at equal acceleration evaluations and equal run time (IV.1).

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
const userAgent = await page.evaluate(() => navigator.userAgent);

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
        return 0.5 * M1 * v2 - Geff * M0 * M1 / Math.sqrt(r * r + eps * eps);
    }

    let evals = 0;
    const acc = () => { evals++; return computeAcceleration(1); };
    function stepEuler(dt) {
        const a = acc();
        s.velocity.x += a.ax * dt; s.velocity.z += a.az * dt;
        s.mesh.position.x += s.velocity.x * dt; s.mesh.position.z += s.velocity.z * dt;
    }
    function stepKDK(dt) {
        let a = acc();
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
        s.mesh.position.x += s.velocity.x * dt; s.mesh.position.z += s.velocity.z * dt;
        a = acc();
        s.velocity.x += a.ax * dt / 2; s.velocity.z += a.az * dt / 2;
    }

    const dt0 = CONFIG.physicsTimeStep, STEPS0 = 24000;

    function accuracy(stepFn, k) {
        reset(); evals = 0;
        const dt = dt0 / k, steps = STEPS0 * k;
        const E0 = energy();
        let maxRel = 0;
        for (let i = 0; i < steps; i++) {
            stepFn(dt);
            const rel = Math.abs((energy() - E0) / E0);
            if (rel > maxRel) maxRel = rel;
        }
        return { maxRel, evals };
    }
    const REPEAT = 9;
    function timing(stepFn, k) {
        const dt = dt0 / k, steps = STEPS0 * k;
        const once = () => { reset(); const t0 = performance.now(); for (let i = 0; i < steps; i++) stepFn(dt); return performance.now() - t0; };
        once();
        const ts = [];
        for (let r = 0; r < REPEAT; r++) ts.push(once());
        ts.sort((a, b) => a - b);
        return { medianMs: ts[(REPEAT - 1) / 2], minMs: ts[0], maxMs: ts[REPEAT - 1] };
    }

    const rows = [];
    for (const [name, fn, ks] of [
        ['semi-implicit Euler', stepEuler, [1, 2, 4, 8, 16, 32, 64, 128, 256]],
        ['KDK', stepKDK, [1, 2, 4, 8]],
    ]) {
        for (const k of ks) {
            const a = accuracy(fn, k);
            const t = timing(fn, k);
            rows.push({ method: name, k, dt: dt0 / k, steps: STEPS0 * k, accelEvals: a.evals, maxRel: a.maxRel, ...t });
        }
    }
    return { meta: { Geff, eps, M0, M1, R0, VT, dt0, steps0: STEPS0, physTime: STEPS0 * dt0, repeat: REPEAT }, rows };
});
await browser.close();

result.meta.userAgent = userAgent;
const rows = result.rows;
const kdk1 = rows.find(r => r.method === 'KDK' && r.k === 1);
const eu1 = rows.find(r => r.method === 'semi-implicit Euler' && r.k === 1);
const eu2 = rows.find(r => r.method === 'semi-implicit Euler' && r.k === 2);
const eus = rows.filter(r => r.method === 'semi-implicit Euler');
let match = null;
for (let i = 1; i < eus.length; i++) {
    const a = eus[i - 1], b = eus[i];
    if (a.maxRel >= kdk1.maxRel && b.maxRel <= kdk1.maxRel) {
        const f = Math.log(a.maxRel / kdk1.maxRel) / Math.log(a.maxRel / b.maxRel);
        const lerp = (x, y) => Math.exp(Math.log(x) + f * (Math.log(y) - Math.log(x)));
        match = { k: lerp(a.k, b.k), accelEvals: lerp(a.accelEvals, b.accelEvals), medianMs: lerp(a.medianMs, b.medianMs) };
        break;
    }
}
result.summary = {
    sameStep: { euler: eu1.maxRel, kdk: kdk1.maxRel, ratio: eu1.maxRel / kdk1.maxRel },
    sameEvals: { euler: eu2.maxRel, kdk: kdk1.maxRel, ratio: eu2.maxRel / kdk1.maxRel, evals: kdk1.accelEvals },
    timeRatioKdkOverEulerSameStep: kdk1.medianMs / eu1.medianMs,
    eulerToMatchKdk: match && { ...match, evalRatio: match.accelEvals / kdk1.accelEvals, timeRatio: match.medianMs / kdk1.medianMs },
};

console.log('UA:', userAgent);
console.log('method               k    evals      maxRel(%)     time median [min,max] ms');
for (const r of rows) console.log(`${r.method.padEnd(20)} ${String(r.k).padStart(3)} ${String(r.accelEvals).padStart(9)}  ${(r.maxRel * 100).toExponential(3).padStart(11)}  ${r.medianMs.toFixed(2)} [${r.minMs.toFixed(2)}, ${r.maxMs.toFixed(2)}]`);
console.log('\nsummary:', JSON.stringify(result.summary, null, 1));
if (errs.length) console.log('\npageerrors:', JSON.stringify(errs));

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/cost_accuracy.json', import.meta.url), JSON.stringify(result, null, 1));
console.log('\nSaved measurements/results/cost_accuracy.json');
