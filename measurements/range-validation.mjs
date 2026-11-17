import { advanceGeodesic, geodesicEnergySquared } from '../physics/geodesic.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';

// Extends reference-validation.mjs over initial radius, eccentricity, M and step size,
// including orbits close to the stability boundary (separatrix p = (6 + 2e) M; ISCO at e = 0).
// Only the system's trapezoidal rule is run. The app's correction boundaries (2.5M, 340) are
// active as in the app; a run that touches them is recorded instead of rejected.
// The independent reference is evaluated in analyze-range.py.
const h0 = 260 / 120;
const hCoarse = 2 * h0;                 // levels: 2Δτ0, Δτ0, Δτ0/2, Δτ0/4, Δτ0/8
const divisors = [1, 2, 4, 8, 16];
const cycles = 6;
const OUTER = 340;
const cases = [];
for (const M of [1, 5, 10]) for (const e of [0, 0.1, 0.3, 0.6]) {
    const pSep = (6 + 2 * e) * M;
    const ps = [];
    // near the separatrix: Δ = p/M − (6 + 2e)
    for (const d of [0.25, 1, 4]) ps.push({ p: pSep + d * M, group: 'near', delta: d });
    // display-scale orbits (same p as reference-validation and beyond), if they fit inside the boundary
    for (const p of [60, 120, 240]) if (p > pSep + 4 * M) ps.push({ p, group: 'display', delta: p / M - (6 + 2 * e) });
    for (const { p, group, delta } of ps) {
        const rp = p / (1 + e), ra = p / (1 - e);
        if (ra >= OUTER) continue;
        const L = Math.sqrt(M * p * p / (p - M * (3 + e * e)));
        const E2 = ((p - 2 * M) ** 2 - 4 * M * M * e * e) / (p * (p - M * (3 + e * e)));
        // Composite Simpson only estimates the run duration; it is not the reference.
        const dtDchi = chi => Math.pow(p, 1.5) / Math.sqrt(M) * Math.sqrt(1 - (3 + e * e) * M / p)
            / ((1 + e * Math.cos(chi)) ** 2 * Math.sqrt(1 - (6 + 2 * e * Math.cos(chi)) * M / p));
        const intervals = 8192, dchi = 2 * Math.PI / intervals;
        let sum = 0;
        for (let k = 0; k <= intervals; k++) sum += (k === 0 || k === intervals ? 1 : k % 2 ? 4 : 2) * dtDchi(k * dchi);
        const periodEstimate = sum * dchi / 3;
        const baseSteps = Math.ceil(cycles * periodEstimate / hCoarse);
        const stride = Math.max(1, Math.floor(baseSteps / 2048));
        const sampleSteps = [];
        for (let k = 0; k <= baseSteps; k += stride) sampleSteps.push(k);
        if (sampleSteps.at(-1) !== baseSteps) sampleSteps.push(baseSteps);
        const runs = [];
        for (const divisor of divisors) {
            const g = { r: rp, vr: 0, phi: 0, L };
            const samples = [[rp, 0]];
            let sampleIndex = 1, maxEnergyRelative = 0, minR = rp, maxR = rp, boundary = null, finite = true;
            for (let k = 1; k <= baseSteps * divisor; k++) {
                const b = advanceGeodesic(g, M, hCoarse / divisor, { innerRadius: 2.5 * M, outerRadius: OUTER });
                if (b && !boundary) boundary = { side: b, step: k };
                if (!Number.isFinite(g.r) || !Number.isFinite(g.phi)) { finite = false; break; }
                minR = Math.min(minR, g.r); maxR = Math.max(maxR, g.r);
                maxEnergyRelative = Math.max(maxEnergyRelative, Math.abs(geodesicEnergySquared(g, M) - E2) / E2);
                if (k === sampleSteps[sampleIndex] * divisor) { samples.push([g.r, g.phi]); sampleIndex++; }
            }
            runs.push({ divisor, h: hCoarse / divisor, stepsPerPeriod: periodEstimate / (hCoarse / divisor),
                maxEnergyRelative, minR, maxR, boundary, finite, samples });
        }
        const id = `M${M}-e${e}-p${+p.toFixed(3)}`;
        cases.push({ id, group, delta, M, p, e, rp, ra, L, E2, pSep, periodEstimate, baseSteps, sampleSteps, runs });
        const b = runs.find(r => r.boundary);
        console.log(`${id.padEnd(22)} ${group.padEnd(7)} Δ=${delta.toFixed(2).padStart(6)}  steps/period at Δτ0 = ${(periodEstimate / h0).toFixed(0).padStart(6)}${b ? `  boundary(${b.boundary.side}) at h=${b.h.toFixed(3)}` : ''}`);
    }
}
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const moduleFile = new URL('../physics/geodesic.mjs', import.meta.url);
const meta = { generatedAt: new Date().toISOString(), h0, hCoarse, divisors, cycles, outer: OUTER,
    node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model,
    physicsSha256: createHash('sha256').update(readFileSync(moduleFile)).digest('hex') };
writeFileSync(new URL('./results/range-trajectories.json', import.meta.url), JSON.stringify({ meta, cases }));
console.log(`${cases.length} cases saved to measurements/results/range-trajectories.json`);
