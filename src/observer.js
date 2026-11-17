// Camera views: the orbiting overview (GOD) and the first-person observer (FPS).
// The observer moves by Newtonian rules in both modes; it is a way to look at the surface,
// not a geodesic.
import * as THREE from 'three';
import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js";
import { CONFIG } from './config.js';
import { state } from './state.js';
import { camera, orbitControls } from './scene.js';
import { surfaceDepth } from './surface.js';
import { showGodView, showObserverStatus } from './hud.js';

const OBSERVER_FORCE_SCALE = 300.0;
const LOOK_SENSITIVITY = 0.002;
const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };

export function setGodView() {
    state.viewMode = 'GOD';
    orbitControls.enabled = true;

    gsap.killTweensOf(camera.position);
    gsap.to(camera.position, {
        x: 0, y: 400, z: 600,
        duration: 1.5,
        ease: "power2.inOut",
        onUpdate: () => { camera.lookAt(0, 0, 0); }
    });

    showGodView();
    document.body.style.cursor = "default";
}

export function setFpsView() {
    state.viewMode = 'FPS';
    orbitControls.enabled = false;
    // A running GOD-view tween would keep overriding the camera rotation.
    gsap.killTweensOf(camera.position);
    state.fps.yaw = 0;
    state.fps.pitch = 0;
    state.fps.phase = 'APPROACH';
    state.fps.freeFlight = false;
    camera.rotation.set(0, 0, 0, 'YXZ');
    state.user.position.set(0, 0, 300);
    state.user.velocity.set(0, 0, 0);
    state.user.smoothY = surfaceDepth(0, 300);
    camera.position.copy(state.user.position);
    camera.position.y += CONFIG.userHeightOffset;
    showObserverStatus();
    document.body.style.cursor = "grab";
}

export function toggleView() {
    if (state.viewMode === 'GOD') setFpsView();
    else setGodView();
}

export function initObserverControls() {
    window.addEventListener('keydown', (e) => {
        // Space switches between following the grid and flying at y = 0, once the observer has arrived.
        if (e.code === 'Space' && state.viewMode === 'FPS' && state.fps.phase === 'ARRIVED') {
            e.preventDefault();
            state.fps.freeFlight = !state.fps.freeFlight;
            showObserverStatus();
        }
        if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
        if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
    });
    window.addEventListener('mousedown', (e) => {
        if (state.viewMode === 'FPS' && !e.target.closest('button') && e.button === 0) {
            state.fps.isDragging = true;
            document.body.style.cursor = "grabbing";
        }
    });
    window.addEventListener('mouseup', () => {
        state.fps.isDragging = false;
        if (state.viewMode === 'FPS') document.body.style.cursor = "grab";
    });
    window.addEventListener('mousemove', (e) => {
        if (state.viewMode !== 'FPS' || !state.fps.isDragging) return;
        state.fps.yaw -= e.movementX * LOOK_SENSITIVITY;
        state.fps.pitch -= e.movementY * LOOK_SENSITIVITY;
        state.fps.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.fps.pitch));
        camera.rotation.set(state.fps.pitch, state.fps.yaw, 0, 'YXZ');
    });
}

// Until the observer reaches a mass it is pulled in by a softened attraction; after that,
// gravity is off and WASD is the only thrust.
export function updateObserver(deltaTime) {
    if (state.viewMode !== 'FPS') return;
    const arrived = state.fps.phase === 'ARRIVED';
    const thrustPower = arrived ? CONFIG.observerFreeThrust : CONFIG.observerThrust;
    const inputAccel = new THREE.Vector3();
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();

    if (keys.KeyW) inputAccel.add(direction);
    if (keys.KeyS) inputAccel.sub(direction);
    if (keys.KeyD) inputAccel.add(right);
    if (keys.KeyA) inputAccel.sub(right);
    if (inputAccel.lengthSq() > 0) inputAccel.normalize().multiplyScalar(thrustPower);

    const gravityAccel = new THREE.Vector3(0, 0, 0);
    const pos = state.user.position;

    if (!arrived) {
        for (const m of state.masses) {
            const dx = m.mesh.position.x - pos.x, dz = m.mesh.position.z - pos.z;
            const reach = m.mesh.scale.x + CONFIG.observerArrivalPad;
            if (dx * dx + dz * dz < reach * reach) {
                state.fps.phase = 'ARRIVED';
                state.user.velocity.set(0, 0, 0);
                showObserverStatus();
                break;
            }
        }
    }

    if (state.fps.phase !== 'ARRIVED') {
        state.masses.forEach(massObj => {
            const dx = massObj.mesh.position.x - pos.x;
            const dz = massObj.mesh.position.z - pos.z;
            const distSq = dx * dx + dz * dz + CONFIG.epsilon * CONFIG.epsilon;
            const dist = Math.sqrt(distSq);
            const effMass = massObj.mass * massObj.growth;
            const forceMagnitude = (CONFIG.gravityK * effMass * CONFIG.userMass) / distSq * OBSERVER_FORCE_SCALE * CONFIG.observerGravityScale;
            gravityAccel.x += (dx / dist) * forceMagnitude;
            gravityAccel.z += (dz / dist) * forceMagnitude;
        });
    }

    const totalAccel = inputAccel.add(gravityAccel);
    state.user.velocity.addScaledVector(totalAccel, deltaTime);
    state.user.velocity.multiplyScalar(Math.max(0, 1.0 - CONFIG.observerFriction * deltaTime));
    state.user.position.addScaledVector(state.user.velocity, deltaTime);

    const r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (r > CONFIG.observerLimit) {
        const nx = pos.x / r, nz = pos.z / r;
        pos.x = nx * CONFIG.observerLimit;
        pos.z = nz * CONFIG.observerLimit;
        const vn = state.user.velocity.x * nx + state.user.velocity.z * nz;
        if (vn > 0) {
            state.user.velocity.x -= 1.5 * vn * nx;
            state.user.velocity.z -= 1.5 * vn * nz;
        }
    }

    // Ease the camera height towards its target so steep Flamm walls do not jolt the view.
    const targetY = state.fps.freeFlight ? 0 : surfaceDepth(pos.x, pos.z);
    const k = 1.0 - Math.exp(-CONFIG.observerHeightSmooth * deltaTime);
    state.user.smoothY += (targetY - state.user.smoothY) * k;
    pos.y = state.user.smoothY;

    camera.position.copy(pos);
    camera.position.y += CONFIG.userHeightOffset;
}
