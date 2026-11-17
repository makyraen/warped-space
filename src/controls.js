// Buttons, keyboard shortcuts, placing masses by click-and-hold, and the delete menu.
import * as THREE from 'three';
import { CONFIG, massToScale, scaleToMass } from './config.js';
import { state, STUDY_MODEL } from './state.js';
import { scene, camera } from './scene.js';
import { setSurfaceModel } from './surface.js';
import { massGeometry, createMass, removeMass, refreshMasses } from './masses.js';
import { presetSlotPosition, circularizePreset, launchOrbit, randomPosition, clampToOrbitRegion, holdOutsideOrbitRegion, releaseHeld } from './placement.js';
import { setGodView, toggleView } from './observer.js';
import { btnAdd, btnModel, showModel, showStudyModel, showInitialModelNote, showPlacementMode, showSpawnMode } from './hud.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ visible: false }));
dragPlane.rotation.x = -Math.PI / 2;
scene.add(dragPlane);

let spawnGhost = null;
let selectedMassForDelete = null;

const contextMenu = document.getElementById("context-menu");
const btnDelete = document.getElementById("btn-delete-mass");
const DELETE_LABEL = "🗑️ Delete Mass";
const CENTER_LABEL = "중심 질량 (삭제 불가)<br><small>기하를 정의합니다. 비우려면 Reset All</small>";

function setPointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
}

export function toggleModel() {
    if (STUDY_MODEL) return;
    state.model = (state.model === 'RUBBER') ? 'FLAMM' : 'RUBBER';
    if (state.model === 'FLAMM') holdOutsideOrbitRegion();
    else releaseHeld();
    setSurfaceModel(state.model);
    showModel(state.model);
}

function resetAll() {
    state.masses.forEach(removeMass);
    state.masses = [];
    if (state.isSpawning) endSpawnMode();
    refreshMasses();
    setGodView();
}

function togglePlacementMode() {
    state.randomPlacement = !state.randomPlacement;
    showPlacementMode();
}

// Adds n masses at once, as many as the limit allows.
function spawnPreset(n) {
    const room = CONFIG.maxMassCount - state.masses.length;
    const count = Math.min(n, room);
    if (count <= 0) return;
    if (state.isSpawning) endSpawnMode();
    for (let k = 0; k < count; k++) {
        const slot = state.masses.length;
        const pos = state.randomPlacement ? randomPosition() : presetSlotPosition(slot);
        const mass = CONFIG.presetMass;
        // Fixed presets get their speeds once the last one has settled, when the configuration is complete.
        const opts = state.randomPlacement ? { onSettled: launchOrbit } : {
            ecc: CONFIG.presetEcc,
            onSettled: () => { if (!state.masses.some(m => m.settling)) circularizePreset(); }
        };
        createMass(pos, massToScale(mass), mass, opts);
    }
}

function startSpawnMode() {
    if (state.isSpawning) return;
    if (state.masses.length >= CONFIG.maxMassCount) return;
    state.isSpawning = true;
    showSpawnMode(true);
}

function endSpawnMode() {
    state.isSpawning = false;
    state.isCharging = false;
    if (spawnGhost) {
        scene.remove(spawnGhost);
        spawnGhost.material.dispose();
        spawnGhost = null;
    }
    showSpawnMode(false);
    refreshMasses();
}

// Ground point under the pointer. When the ray misses the plane (looking at the sky),
// use a point 300 ahead of the camera instead.
function spawnPointFromRay() {
    const p = new THREE.Vector3();
    const hit = raycaster.intersectObject(dragPlane);
    if (hit.length > 0) {
        p.copy(hit[0].point);
    } else {
        const forward = raycaster.ray.direction.clone();
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        p.copy(camera.position).addScaledVector(forward, 300);
        p.y = 0;
    }
    const r = Math.sqrt(p.x * p.x + p.z * p.z);
    if (r > CONFIG.massLimit) {
        p.x *= CONFIG.massLimit / r;
        p.z *= CONFIG.massLimit / r;
    }
    return clampToOrbitRegion(p);
}

// The central mass defines the background geometry, so it cannot be deleted on its own.
const isCenterMass = (mesh) => state.masses.length > 0 && state.masses[0].mesh === mesh;

function onKeyDown(e) {
    if (e.code === 'KeyV') toggleView();
    if (e.code === 'KeyM') { if (state.isSpawning) endSpawnMode(); else startSpawnMode(); }
    if (e.code === 'KeyC') toggleModel();
    if (e.code === 'KeyR') togglePlacementMode();
    if (/^Digit[1-5]$/.test(e.code)) spawnPreset(Number(e.code.slice(5)));
    if (e.code === 'Escape' && state.isSpawning) endSpawnMode();
}

function onContextMenu(e) {
    e.preventDefault();
    if (e.target.closest("#ui-layer")) return;
    setPointer(e);
    const hits = raycaster.intersectObjects(state.masses.map(m => m.mesh));
    if (hits.length === 0) {
        contextMenu.style.display = "none";
        return;
    }
    selectedMassForDelete = hits[0].object;
    const locked = isCenterMass(selectedMassForDelete);
    btnDelete.classList.toggle("locked", locked);
    btnDelete.innerHTML = locked ? CENTER_LABEL : DELETE_LABEL;
    contextMenu.style.display = "block";
    contextMenu.style.left = e.clientX + "px";
    contextMenu.style.top = e.clientY + "px";
}

function onDeleteClick() {
    if (selectedMassForDelete && !isCenterMass(selectedMassForDelete)) {
        const index = state.masses.findIndex(m => m.mesh === selectedMassForDelete);
        if (index > -1) {
            const [obj] = state.masses.splice(index, 1);
            removeMass(obj);
            refreshMasses();
        }
    }
    contextMenu.style.display = "none";
}

function onPointerDown(e) {
    if (e.target.closest("#ui-layer") || e.target.closest("#context-menu") || e.button === 2) return;
    if (!state.isSpawning) return;
    setPointer(e);
    state.isCharging = true;
    state.chargeStartTime = performance.now();
    spawnGhost = new THREE.Mesh(massGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
    spawnGhost.scale.setScalar(massToScale(CONFIG.minMassValue));
    spawnGhost.position.copy(spawnPointFromRay());
    scene.add(spawnGhost);
}

function onPointerMove() {
    if (!(state.isSpawning && state.isCharging && spawnGhost)) return;
    const seconds = (performance.now() - state.chargeStartTime) / 1000;
    const mass = Math.min(CONFIG.minMassValue + seconds * CONFIG.chargeRatePerSec, CONFIG.maxMassValue);
    spawnGhost.scale.setScalar(massToScale(mass));
}

function onPointerUp(e) {
    if (!state.isSpawning) return;
    // Releasing over the panel cancels; the pointer may still be captured by the canvas,
    // so test what is actually under it.
    const overUI = document.elementFromPoint(e.clientX, e.clientY)?.closest("#ui-layer, #context-menu");
    if (overUI) { endSpawnMode(); return; }
    if (state.isCharging && spawnGhost) {
        const mass = THREE.MathUtils.clamp(scaleToMass(spawnGhost.scale.x), CONFIG.minMassValue, CONFIG.maxMassValue);
        createMass(spawnGhost.position.clone(), massToScale(mass), mass, { onSettled: launchOrbit });
    }
    endSpawnMode();
}

export function initControls() {
    document.getElementById("btn-reset").addEventListener("click", resetAll);
    document.getElementById("btn-toggle-view").addEventListener("click", toggleView);
    btnModel.addEventListener("click", toggleModel);
    btnAdd.addEventListener("click", startSpawnMode);
    btnDelete.addEventListener("click", onDeleteClick);

    showInitialModelNote();
    if (STUDY_MODEL) {
        state.model = STUDY_MODEL;
        setSurfaceModel(STUDY_MODEL);
        showStudyModel(STUDY_MODEL);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("click", (e) => { if (!e.target.closest("#context-menu")) contextMenu.style.display = "none"; });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
}
