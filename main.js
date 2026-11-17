import * as THREE from 'three';
import { geodesicRadialAccel, advanceGeodesic } from './physics/geodesic.mjs';
import { CONFIG, massToScale, scaleToMass } from './src/config.js';
import { state, DEBUG } from './src/state.js';
import { scene, renderer, camera, orbitControls, createComposer } from './src/scene.js';
import { shaderMat } from './src/surface.js';
import { createMass, refreshMasses } from './src/masses.js';
import { computeAcceleration, updateMassPhysics, initGeodesic, geodesicOuterRadius } from './src/physics.js';
import { launchOrbit, clampToOrbitRegion } from './src/placement.js';
import { setGodView, updateObserver, initObserverControls } from './src/observer.js';
import { initControls } from './src/controls.js';

setGodView();
initObserverControls();
initControls();

const composer = createComposer();
const clock = new THREE.Clock();
let physicsAccumulator = 0;

// Also checked every frame: a page loaded while hidden (window size 0) gets no resize event later.
const drawSize = new THREE.Vector2();
function fitToWindow() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", fitToWindow);

// Rendering runs once per frame; physics advances in fixed steps of physicsTimeStep.
// Time beyond maxPhysicsStepsPerFrame steps is dropped rather than carried over.
function animate() {
    const frameTime = clock.getDelta();
    shaderMat.uniforms.uTime.value = clock.getElapsedTime();
    if (state.viewMode === 'GOD') orbitControls.update();

    physicsAccumulator += Math.min(frameTime, CONFIG.maxFrameTime);
    let steps = 0;
    while (physicsAccumulator >= CONFIG.physicsTimeStep && steps < CONFIG.maxPhysicsStepsPerFrame) {
        updateObserver(CONFIG.physicsTimeStep);
        if (state.masses.length > 0) updateMassPhysics(CONFIG.physicsTimeStep);
        physicsAccumulator -= CONFIG.physicsTimeStep;
        steps++;
    }
    if (steps === CONFIG.maxPhysicsStepsPerFrame) physicsAccumulator = 0;

    if (state.masses.length > 0) refreshMasses();
    renderer.getSize(drawSize);
    if (drawSize.x !== window.innerWidth || drawSize.y !== window.innerHeight) fitToWindow();
    composer.render();
    requestAnimationFrame(animate);
}
animate();

// Measurement scripts drive the app's own functions through this hook.
if (DEBUG) {
    window.__warped = {
        state, CONFIG, computeAcceleration, geodesicRadialAccel, advanceGeodesic, createMass, massToScale, scaleToMass,
        camera, scene, shaderMat, updateMassPhysics, initGeodesic, launchOrbit, clampToOrbitRegion, geodesicOuterRadius
    };
}

