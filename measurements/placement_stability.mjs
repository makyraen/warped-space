// How often random placements in the Schwarzschild mode reach the correction boundaries (III.4).

import { chromium } from './browser-runtime.mjs';
import { writeFileSync, mkdirSync } from 'fs';

const LABEL = process.argv[2] || 'current';
const TRIALS = 400, SECONDS = 60;
const channel = process.env.WARPED_BROWSER_CHANNEL ?? 'msedge';
const browser = await chromium.launch({ channel: channel || undefined, headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:8777/index.html?debug', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__warped, null, { timeout: 20000 });
await page.waitForTimeout(500);
await page.evaluate(() => { if (window.__warped.state.model !== 'FLAMM') document.getElementById('btn-toggle-model').click(); });

const result = await page.evaluate(({ TRIALS, SECONDS }) => {
    const W = window.__warped;
    const { state, CONFIG, createMass, massToScale, updateMassPhysics } = W;
    let seed = 20261107 >>> 0;
    const rnd = () => (seed = (1103515245 * seed + 12345) >>> 0) / 4294967296;
    const realRandom = Math.random;
    Math.random = rnd;
    createMass({ x: 0, z: 0 }, massToScale(100), 100);
    createMass({ x: 200, z: 0 }, massToScale(20), 20);
    const c = state.masses[0], s = state.masses[1];
    for (const m of [c, s]) { m.growth = 1; m.settling = false; }

    function trial(scenario) {
        const mc = 20 + 180 * rnd();
        const M = mc * CONFIG.massToM;
        c.mass = mc;
        let cx = 0, cz = 0, sx, sz;
        if (scenario === 'A') {
            const r = CONFIG.randomRadiusMin + rnd() * (CONFIG.randomRadiusMax - CONFIG.randomRadiusMin), a = 2 * Math.PI * rnd();
            sx = r * Math.cos(a); sz = r * Math.sin(a);
        } else {
            const d = 200 * rnd(), a = 2 * Math.PI * rnd();
            cx = d * Math.cos(a); cz = d * Math.sin(a);
            const minSep = massToScale(mc) + 10;
            do {
                const r = CONFIG.massLimit * Math.sqrt(rnd()), b = 2 * Math.PI * rnd();
                sx = r * Math.cos(b); sz = r * Math.sin(b);
            } while (Math.hypot(sx - cx, sz - cz) < minSep);
        }
        c.mesh.position.set(cx, 0, cz);
        let initClamp = false;
        if (W.clampToOrbitRegion) {
            const q = W.clampToOrbitRegion({ x: sx, z: sz });
            sx = q.x; sz = q.z;
        } else if (Math.hypot(sx - cx, sz - cz) > CONFIG.massLimit - Math.hypot(cx, cz)) initClamp = true;
        s.mesh.position.set(sx, 0, sz); s.velocity.set(0, 0, 0); s.geo = null;
        const r0 = Math.hypot(sx - cx, sz - cz);
        let outer = false, inner = false, display = false, rMin = Infinity, rMax = 0;
        const steps = Math.round(SECONDS / CONFIG.physicsTimeStep);
        for (let i = 0; i < steps; i++) {
            updateMassPhysics(CONFIG.physicsTimeStep);
            const g = s.geo;
            if (g.r >= CONFIG.massLimit - 1e-9) outer = true;
            if (g.r <= CONFIG.geodesicHorizonPad * M + 1e-9) inner = true;
            const ex = cx + g.r * Math.cos(g.phi), ez = cz + g.r * Math.sin(g.phi);
            if (Math.hypot(s.mesh.position.x - ex, s.mesh.position.z - ez) > 1e-6) display = true;
            rMin = Math.min(rMin, g.r); rMax = Math.max(rMax, g.r);
        }
        return { scenario, mc, M, d: Math.hypot(cx, cz), r0, L: s.geo.L, outer, inner, display, initClamp, rMin, rMax };
    }
    const rows = [];
    for (const sc of ['A', 'B']) for (let k = 0; k < TRIALS; k++) rows.push(trial(sc));
    Math.random = realRandom;
    const summary = {};
    for (const sc of ['A', 'B']) {
        const rs = rows.filter(r => r.scenario === sc);
        const frac = f => +(rs.filter(f).length / rs.length).toFixed(4);
        summary[sc] = { trials: rs.length, outer: frac(r => r.outer), inner: frac(r => r.inner), display: frac(r => r.display),
            any: frac(r => r.outer || r.inner || r.display), outsideOrbitRegionAtPlacement: frac(r => r.initClamp), maxROverR0: +Math.max(...rs.map(r => r.rMax / r.r0)).toFixed(3) };
    }
    return { summary, rows };
}, { TRIALS, SECONDS });
await browser.close();

console.log(`[${LABEL}]`, JSON.stringify(result.summary, null, 1));
if (errs.length) console.log('pageerrors:', errs);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/placement_stability_${LABEL}.json`, import.meta.url),
    JSON.stringify({ meta: { TRIALS, SECONDS, label: LABEL }, ...result }, null, 1));
