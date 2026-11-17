import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const requestedModel = params.get('studyModel')?.toUpperCase();

// ?studyModel=RUBBER|FLAMM fixes the model for user-study pages.
export const STUDY_MODEL = ['RUBBER', 'FLAMM'].includes(requestedModel) ? requestedModel : null;
// ?debug exposes window.__warped for the measurement scripts.
export const DEBUG = params.has('debug');

export const state = {
    viewMode: 'GOD',
    model: 'RUBBER',
    isSpawning: false,
    isCharging: false,
    chargeStartTime: 0,
    masses: [],
    randomPlacement: false,
    // phase: APPROACH (pulled towards the masses) -> ARRIVED (free movement)
    fps: { yaw: 0, pitch: 0, isDragging: false, phase: 'APPROACH', freeFlight: false },
    user: { velocity: new THREE.Vector3(), position: new THREE.Vector3(0, 0, 300), smoothY: 0 }
};
