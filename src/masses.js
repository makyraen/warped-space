import * as THREE from 'three';
import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js";
import { state } from './state.js';
import { scene } from './scene.js';
import { surfaceDepth, syncSurfaceUniforms } from './surface.js';
import { showMassCount } from './hud.js';

const STAR_COLORS = [0x9bb0ff, 0xaabfff, 0xcad7ff, 0xf8f7ff, 0xfff4ea, 0xffd2a1, 0xffcc6f];

// Shared by every mass; never disposed.
export const massGeometry = new THREE.SphereGeometry(1, 64, 64);

export function refreshMasses() {
    syncSurfaceUniforms();
    showMassCount();
}

// Adds a mass whose contribution grows from zero, so the well deepens and the sphere sinks in.
// It stays fixed (settling) until fully grown.
//   opts.ecc       orbital eccentricity used on entering the Schwarzschild mode (random if omitted)
//   opts.onSettled called once growth ends; Newtonian start velocities must be set here,
//                  because velocities are zeroed while settling
export function createMass(pos, scale, mass, opts = {}) {
    const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.5
    });
    const mesh = new THREE.Mesh(massGeometry, material);
    // Grow in place rather than drop from above: a fall would suggest a downward force,
    // which is exactly the misreading of the rubber-sheet picture.
    mesh.scale.set(0, 0, 0);
    mesh.position.set(pos.x, surfaceDepth(pos.x, pos.z), pos.z);
    mesh.userData = { isMass: true, massValue: mass };
    scene.add(mesh);

    const obj = {
        mesh,
        mass,
        velocity: new THREE.Vector3(),
        growth: 0,
        settling: true,
        presetEcc: opts.ecc
    };
    state.masses.push(obj);
    refreshMasses();
    spawnRipple(pos.x, pos.z);

    gsap.to(mesh.scale, { x: scale, y: scale, z: scale, duration: 0.45, ease: "back.out(1.7)" });
    gsap.to(obj, {
        growth: 1,
        duration: 1.4,
        ease: "power2.inOut",
        onComplete: () => {
            obj.settling = false;
            refreshMasses();
            if (opts.onSettled) opts.onSettled(obj);
        }
    });
}

export function removeMass(obj) {
    gsap.killTweensOf(obj);
    gsap.killTweensOf(obj.mesh.scale);
    scene.remove(obj.mesh);
    obj.mesh.material.dispose();
}

// A ring that spreads over the grid from a new mass, following the surface height.
function spawnRipple(x, z) {
    const SEGMENTS = 96;
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
        color: 0x88ddff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const ring = new THREE.LineLoop(geometry, material);
    scene.add(ring);

    const wave = { radius: 0.1 };
    const redraw = () => {
        for (let i = 0; i <= SEGMENTS; i++) {
            const a = (i / SEGMENTS) * Math.PI * 2;
            const px = x + Math.cos(a) * wave.radius;
            const pz = z + Math.sin(a) * wave.radius;
            positions[i * 3] = px;
            positions[i * 3 + 1] = surfaceDepth(px, pz) + 1.5;
            positions[i * 3 + 2] = pz;
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeBoundingSphere();
    };
    redraw();

    gsap.to(wave, { radius: 180, duration: 1.2, ease: "power2.out", onUpdate: redraw });
    gsap.to(material, {
        opacity: 0,
        duration: 1.2,
        ease: "power1.in",
        onComplete: () => {
            scene.remove(ring);
            geometry.dispose();
            material.dispose();
        }
    });
}
