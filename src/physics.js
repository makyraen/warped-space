// Fixed-step motion of the masses: softened Newtonian N-body (KDK) in the rubber-sheet mode,
// Schwarzschild test-particle geodesics around the central mass in the Flamm mode.
import * as THREE from 'three';
import { advanceGeodesic } from '../physics/geodesic.mjs';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { restHeight } from './surface.js';

// Acceleration of mass i due to all other masses.
export function computeAcceleration(i) {
    const m1 = state.masses[i];
    let ax = 0, az = 0;
    for (let j = 0; j < state.masses.length; j++) {
        if (i === j) continue;
        const m2 = state.masses[j];
        const m2Mass = m2.mass * m2.growth;
        if (m2Mass <= 0) continue;
        const dx = m2.mesh.position.x - m1.mesh.position.x;
        const dz = m2.mesh.position.z - m1.mesh.position.z;
        const distSq = dx * dx + dz * dz + CONFIG.epsilon * CONFIG.epsilon;
        const dist = Math.sqrt(distSq);
        const force = (CONFIG.gravityK * m1.mass * m2Mass) / distSq * CONFIG.physicsSpeedScale;
        ax += (dx / dist) * force / m1.mass;
        az += (dz / dist) * force / m1.mass;
    }
    return { ax, az };
}

// The central mass is pinned, and a mass does not move while it is still growing.
function isIntegrated(i) {
    return !(i === 0 || state.masses[i].settling);
}

// Keeps a mass inside the display disc and rests it on the grid.
function applyBoundaryAndHeight(obj) {
    const limit = CONFIG.massLimit;
    const r = Math.sqrt(obj.mesh.position.x ** 2 + obj.mesh.position.z ** 2);
    if (r > limit) {
        const nx = obj.mesh.position.x / r, nz = obj.mesh.position.z / r;
        obj.mesh.position.x = nx * limit;
        obj.mesh.position.z = nz * limit;
        const vn = obj.velocity.x * nx + obj.velocity.z * nz;
        if (vn > 0) {
            obj.velocity.x -= 1.8 * vn * nx;
            obj.velocity.z -= 1.8 * vn * nz;
        }
    }
    const pos = obj.mesh.position;
    obj.mesh.position.y = restHeight(pos.x, pos.z, obj.mesh.scale.x);
}

export function updateMassPhysics(deltaTime) {
    if (state.model === 'FLAMM') updateGeodesicPhysics(deltaTime);
    else updateNewtonianPhysics(deltaTime);
}

function updateNewtonianPhysics(deltaTime) {
    const halfDt = deltaTime / 2;

    state.masses.forEach((m1, i) => {
        if (!isIntegrated(i)) { m1.velocity.set(0, 0, 0); return; }
        m1.geo = null;   // re-initialised on the next switch to the Flamm mode
        const { ax, az } = computeAcceleration(i);
        m1.velocity.x += ax * halfDt;
        m1.velocity.z += az * halfDt;
    });

    state.masses.forEach((obj) => {
        obj.mesh.position.addScaledVector(obj.velocity, deltaTime);
        applyBoundaryAndHeight(obj);
    });

    state.masses.forEach((m1, i) => {
        if (!isIntegrated(i)) return;
        const { ax, az } = computeAcceleration(i);
        m1.velocity.x += ax * halfDt;
        m1.velocity.z += az * halfDt;
    });
}

// Outer limit of a geodesic orbit, measured from the central mass. With the centre at distance d
// from the screen origin, orbits inside massLimit - d also stay inside the display disc.
export function geodesicOuterRadius(center, M) {
    const d = Math.hypot(center.mesh.position.x, center.mesh.position.z);
    return Math.max(CONFIG.massLimit - d, CONFIG.geodesicHorizonPad * M + 1);
}

// Starts a bound orbit with the current radius as apoapsis: p = r(1 - e), L^2 = M p^2 / (p - M(3 + e^2)).
// e is reduced if needed so that p stays geodesicSepMargin * M outside the separatrix (6 + 2e)M.
export function initGeodesic(obj, center, M) {
    const dx = obj.mesh.position.x - center.mesh.position.x;
    const dz = obj.mesh.position.z - center.mesh.position.z;
    const rOuter = geodesicOuterRadius(center, M);
    const r = THREE.MathUtils.clamp(Math.sqrt(dx * dx + dz * dz), CONFIG.geodesicHorizonPad * M, rOuter);
    const phi = Math.atan2(dz, dx);
    let e = (obj.presetEcc !== undefined)
        ? obj.presetEcc
        : CONFIG.geodesicEccMin + Math.random() * (CONFIG.geodesicEccMax - CONFIG.geodesicEccMin);
    const eStable = (r - (6 + CONFIG.geodesicSepMargin) * M) / (r + 2 * M);
    let L;
    if (eStable >= 0) {
        e = Math.min(e, eStable);
        const p = r * (1 - e);
        L = Math.sqrt(M * p * p / (p - M * (3 + e * e)));
    } else {
        // Too close for a stable bound orbit: use the circular angular momentum.
        const rSafe = Math.max(r, CONFIG.geodesicMinRFactor * M);
        L = Math.sqrt(M * rSafe * rSafe / (rSafe - 3 * M));
    }
    obj.geo = { r, phi, vr: 0, L };
}

function updateGeodesicPhysics(deltaTime) {
    if (state.masses.length === 0) return;
    const center = state.masses[0];
    const M = center.mass * center.growth * CONFIG.massToM;
    const dtau = deltaTime * CONFIG.geodesicTimeScale;

    state.masses.forEach((obj, i) => {
        if (obj.held) { applyBoundaryAndHeight(obj); return; }
        if (i === 0 || obj.settling || M <= 0) {
            obj.velocity.set(0, 0, 0);
            applyBoundaryAndHeight(obj);
            return;
        }

        if (!obj.geo) initGeodesic(obj, center, M);
        const g = obj.geo;
        advanceGeodesic(g, M, dtau, {
            innerRadius: CONFIG.geodesicHorizonPad * M,
            outerRadius: geodesicOuterRadius(center, M),
        });

        const cosP = Math.cos(g.phi), sinP = Math.sin(g.phi);
        obj.mesh.position.x = center.mesh.position.x + g.r * cosP;
        obj.mesh.position.z = center.mesh.position.z + g.r * sinP;
        // Keep a Cartesian velocity so switching back to the Newtonian mode continues smoothly.
        const vtan = g.L / g.r;
        obj.velocity.x = g.vr * cosP - vtan * sinP;
        obj.velocity.z = g.vr * sinP + vtan * cosP;

        applyBoundaryAndHeight(obj);
    });
}
