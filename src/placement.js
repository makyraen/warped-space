// Where new masses go and how fast they start.
import { CONFIG } from './config.js';
import { state } from './state.js';
import { computeAcceleration, geodesicOuterRadius } from './physics.js';

// Preset positions depend only on the slot index, so pressing 1 then 4 gives the same scene as 5.
// Slot 0 is the centre: it defines M in the Flamm mode and is pinned.
export function presetSlotPosition(slot) {
    if (slot === 0) return { x: 0, z: 0 };
    const satellites = CONFIG.maxMassCount - 1;
    const angle = ((slot - 1) / satellites) * Math.PI * 2;
    return { x: CONFIG.presetRadius * Math.cos(angle), z: CONFIG.presetRadius * Math.sin(angle) };
}

// Tangential speed sqrt(a_r r) from the full N-body force, since the satellites also attract each other.
// Growth is set to 1 for the calculation so the result is the speed for the fully grown configuration.
export function circularizePreset() {
    if (state.masses.length < 2) return;
    const center = state.masses[0].mesh.position;
    const saved = state.masses.map(m => m.growth);
    state.masses.forEach(m => { m.growth = 1; });

    const plan = state.masses.map((m, i) => {
        if (i === 0) return null;
        const dx = m.mesh.position.x - center.x, dz = m.mesh.position.z - center.z;
        const r = Math.hypot(dx, dz);
        if (r < 1) return null;
        const nx = dx / r, nz = dz / r;
        const { ax, az } = computeAcceleration(i);
        const aRadial = -(ax * nx + az * nz);
        if (aRadial <= 0) return null;
        return { nx, nz, speed: CONFIG.presetSpeedFactor * Math.sqrt(aRadial * r) };
    });

    state.masses.forEach((m, i) => { m.growth = saved[i]; });
    state.masses.forEach((m, i) => {
        const p = plan[i];
        if (!p) return;
        m.velocity.set(-p.nz * p.speed, 0, p.nx * p.speed);
    });
}

// onSettled for hand-placed and random masses: 80-100% of the circular speed about the centre.
export function launchOrbit(obj) {
    const i = state.masses.indexOf(obj);
    if (i <= 0) return;
    const center = state.masses[0].mesh.position;
    const dx = obj.mesh.position.x - center.x, dz = obj.mesh.position.z - center.z;
    const r = Math.hypot(dx, dz);
    if (r < 1) return;
    const nx = dx / r, nz = dz / r;
    const { ax, az } = computeAcceleration(i);
    const aRadial = -(ax * nx + az * nz);
    if (aRadial <= 0) return;
    const speed = (0.8 + 0.2 * Math.random()) * Math.sqrt(aRadial * r);
    obj.velocity.set(-nz * speed, 0, nx * speed);
}

export function randomPosition() {
    const angle = Math.random() * Math.PI * 2;
    const r = CONFIG.randomRadiusMin + Math.random() * (CONFIG.randomRadiusMax - CONFIG.randomRadiusMin);
    return clampToOrbitRegion({ x: r * Math.cos(angle), z: r * Math.sin(angle) });
}

// In the Flamm mode, moves a placement inside the geodesic outer limit so the orbit starts
// where the sphere appeared.
export function clampToOrbitRegion(p) {
    if (state.model !== 'FLAMM' || state.masses.length === 0) return p;
    const center = state.masses[0];
    const rOuter = geodesicOuterRadius(center, center.mass * CONFIG.massToM);
    const dx = p.x - center.mesh.position.x, dz = p.z - center.mesh.position.z;
    const r = Math.hypot(dx, dz);
    if (r > rOuter) {
        p.x = center.mesh.position.x + dx * rOuter / r;
        p.z = center.mesh.position.z + dz * rOuter / r;
    }
    return p;
}

// Entering the Flamm mode: a mass outside the geodesic region (outer limit 340 - d, inner limit 2.5M)
// stays where it is, dimmed, and is not integrated. Satellites do not act on anything in this mode,
// so nothing else changes. It moves again in the Newtonian mode with the velocity it had.
export function holdOutsideOrbitRegion() {
    if (state.masses.length < 2) return;
    const center = state.masses[0];
    const M = center.mass * CONFIG.massToM;
    const rOuter = geodesicOuterRadius(center, M), rInner = CONFIG.geodesicHorizonPad * M;
    state.masses.forEach((obj, i) => {
        if (i === 0) return;
        const r = Math.hypot(obj.mesh.position.x - center.mesh.position.x, obj.mesh.position.z - center.mesh.position.z);
        setHeld(obj, r > rOuter || r < rInner);
    });
}

export function releaseHeld() {
    state.masses.forEach(obj => setHeld(obj, false));
}

function setHeld(obj, held) {
    obj.held = held;
    obj.mesh.material.transparent = held;
    obj.mesh.material.opacity = held ? 0.3 : 1;
}
