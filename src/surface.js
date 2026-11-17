// The grid surface. Depth is computed twice: in the vertex shader for the grid and in
// surfaceDepth() for everything placed on it (spheres, ripples, the observer camera).
// The two must stay identical.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { state } from './state.js';
import { scene } from './scene.js';

const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform int uMassCount;
    uniform vec3 uMassPositions[5];
    uniform float uMassValues[5];
    uniform float uK;
    uniform float uEpsilon;
    uniform int uMode;           // 0 = rubber sheet, 1 = Flamm paraboloid
    uniform float uR0;
    uniform float uMassToM;
    uniform float uPullStrength;

    varying float vHeight;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    float flammZ(float M, float r) {
        return sqrt(8.0 * M * max(r - 2.0 * M, 0.0));
    }

    void main() {
        vUv = uv;
        vec3 newPos = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);

        float displacement = 0.0;
        vec3 pull = vec3(0.0);

        for (int i = 0; i < 5; i++) {
            if (i >= uMassCount) break;
            // Only the central mass shapes the Flamm surface; orbiting bodies are test particles.
            if (uMode == 1 && i != 0) continue;

            float dx = worldPosition.x - uMassPositions[i].x;
            float dz = worldPosition.z - uMassPositions[i].z;
            float rTrue = sqrt(dx * dx + dz * dz);
            float rSoft = sqrt(dx * dx + dz * dz + uEpsilon * uEpsilon);

            float depth;
            if (uMode == 1) {
                float M = uMassValues[i] * uMassToM;
                float rc = clamp(rTrue, 2.0 * M, uR0);
                depth = -(flammZ(M, uR0) - flammZ(M, rc));
            } else {
                depth = -uK * (uMassValues[i] / rSoft);
            }
            displacement += depth;

            if (uMode == 0) {
                // Draw grid lines towards the mass; capped so vertices never cross the centre.
                float pullMag = min(abs(depth) * 0.2, 0.35 * rSoft) * uPullStrength;
                pull.x -= (dx / rSoft) * pullMag;
                pull.y -= (dz / rSoft) * pullMag;
            }
        }

        float distFromCenter = length(worldPosition.xz);

        if (uMode == 0) {
            // The rubber sheet is faded to zero at the edge; the Flamm depth is already zero at uR0.
            float edgeFactor = 1.0 - smoothstep(350.0, 490.0, distFromCenter);
            displacement *= edgeFactor;
            pull *= edgeFactor;
        }

        newPos.z += displacement;
        newPos.x += pull.x;
        newPos.y -= pull.y;

        vHeight = displacement;
        vWorldPosition = (modelMatrix * vec4(newPos, 1.0)).xyz;

        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(newPos, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    varying float vHeight;
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    uniform vec3 uGridColor;
    uniform vec3 uBaseColor;
    uniform float uGridScale;
    uniform float uDepthScale;

    void main() {
        vec2 gridUV = vUv * uGridScale;
        vec2 dudv = fwidth(gridUV);
        vec2 grid = abs(fract(gridUV - 0.5) - 0.5) / dudv;
        float line = min(grid.x, grid.y);
        float gridIntensity = 1.0 - min(line, 1.0);

        // Where several grid cells fall into one pixel the lines merge into a solid fill; hide them.
        float cellsPerPixel = max(dudv.x, dudv.y);
        gridIntensity *= 1.0 - smoothstep(0.6, 1.6, cellsPerPixel);

        float depth = 1.0 - exp(-abs(vHeight) / uDepthScale);

        vec3 targetColor = vec3(1.0, 0.5, 0.1);
        vec3 depthColor = mix(uGridColor, targetColor, depth);
        vec3 finalColor = mix(uBaseColor, depthColor, gridIntensity);

        float glowFactor = 0.25 + depth * 0.35;
        finalColor += depthColor * gridIntensity * glowFactor;

        float dist = length(vWorldPosition.xz);
        float fade = 1.0 - smoothstep(300.0, 500.0, dist);

        gl_FragColor = vec4(finalColor * fade, 1.0);
    }
`;

export function flammZ(M, r) {
    return Math.sqrt(8.0 * M * Math.max(r - 2.0 * M, 0.0));
}

// Height of the grid at (x, z); zero or negative. Mirrors the vertex shader.
export function surfaceDepth(x, z) {
    let depth = 0.0;
    state.masses.forEach((massObj, i) => {
        if (state.model === 'FLAMM' && i !== 0) return;
        const dx = x - massObj.mesh.position.x;
        const dz = z - massObj.mesh.position.z;
        const effMass = massObj.mass * massObj.growth;
        if (effMass <= 0) return;
        if (state.model === 'FLAMM') {
            const M = effMass * CONFIG.massToM;
            const rTrue = Math.sqrt(dx * dx + dz * dz);
            const rc = THREE.MathUtils.clamp(rTrue, 2.0 * M, CONFIG.embedR0);
            depth += -(flammZ(M, CONFIG.embedR0) - flammZ(M, rc));
        } else {
            const rSoft = Math.sqrt(dx * dx + dz * dz + CONFIG.epsilon * CONFIG.epsilon);
            depth += -CONFIG.gravityK * (effMass / rSoft);
        }
    });
    if (state.model !== 'FLAMM') {
        const distFromCenter = Math.sqrt(x * x + z * z);
        depth *= 1.0 - THREE.MathUtils.smoothstep(350.0, 490.0, distFromCenter);
    }
    return depth;
}

// Height of the centre of a sphere of radius R resting on the grid. Sampling a disc under the
// sphere keeps it from cutting into steep walls, where the centre depth alone is not enough.
export function restHeight(x, z, R) {
    let y = surfaceDepth(x, z) + R;
    const RINGS = 4, SECTORS = 8;
    for (let i = 1; i <= RINGS; i++) {
        const d = R * (i / RINGS);
        const lift = Math.sqrt(Math.max(R * R - d * d, 0));
        for (let j = 0; j < SECTORS; j++) {
            const a = (j / SECTORS) * Math.PI * 2;
            const h = surfaceDepth(x + d * Math.cos(a), z + d * Math.sin(a)) + lift;
            if (h > y) y = h;
        }
    }
    return y;
}

const planeGeometry = new THREE.PlaneGeometry(CONFIG.planeSize, CONFIG.planeSize, 200, 200);

export const shaderMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: {
        uTime: { value: 0 },
        uMassCount: { value: 0 },
        uMassPositions: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
        uMassValues: { value: new Float32Array(5) },
        uK: { value: CONFIG.gravityK },
        uEpsilon: { value: CONFIG.epsilon },
        uGridColor: { value: new THREE.Color(0x0088ff) },
        uBaseColor: { value: new THREE.Color(0x02020a) },
        uGridScale: { value: CONFIG.gridScale },
        uMode: { value: 0 },
        uR0: { value: CONFIG.embedR0 },
        uMassToM: { value: CONFIG.massToM },
        uDepthScale: { value: CONFIG.depthColorScale },
        uPullStrength: { value: CONFIG.rubberPullStrength },
    }
});

const plane = new THREE.Mesh(planeGeometry, shaderMat);
plane.rotation.x = -Math.PI / 2;
scene.add(plane);

export function setSurfaceModel(model) {
    shaderMat.uniforms.uMode.value = model === 'FLAMM' ? 1 : 0;
}

export function syncSurfaceUniforms() {
    shaderMat.uniforms.uMassCount.value = state.masses.length;
    const positions = shaderMat.uniforms.uMassPositions.value;
    const values = shaderMat.uniforms.uMassValues.value;
    for (let i = 0; i < 5; i++) {
        if (i < state.masses.length) {
            positions[i].copy(state.masses[i].mesh.position);
            values[i] = state.masses[i].mass * state.masses[i].growth;
        } else {
            positions[i].set(9999, 9999, 9999);
            values[i] = 0;
        }
    }
}
