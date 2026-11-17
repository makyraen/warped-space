// Text and button states in the on-screen panel.
import { CONFIG } from './config.js';
import { state } from './state.js';

const viewModeText = document.getElementById('view-mode-text');
const massCount = document.getElementById('mass-count');
const modelNote = document.getElementById('model-note');
const placementMode = document.getElementById('placement-mode');
export const btnAdd = document.getElementById('btn-add-mass');
export const btnModel = document.getElementById('btn-toggle-model');

const MODEL_NOTES = {
    RUBBER: "Rubber-sheet: Plummer 소프트닝 퍼텐셜 (−K·m/√(r²+ε²)). 곡면은 공간 곡률이 아니라 퍼텐셜 그래프.",
    FLAMM: "Flamm paraboloid: z(r)=√(8M(r−2M)), r=490에서 절단. 중심 질량 하나만 반영 — 궤도체는 곡면을 바꾸지 않는 시험입자."
};

export function showGodView() {
    viewModeText.innerText = "GOD MODE";
    viewModeText.style.color = "#ff8800";
}

export function showObserverStatus() {
    if (state.viewMode !== 'FPS') return;
    if (state.fps.phase !== 'ARRIVED') {
        viewModeText.innerText = "OBSERVER: 표면 탐색 이동 중 (질량에 다가가면 조작 가능)";
        viewModeText.style.color = "#00ccff";
    } else if (state.fps.freeFlight) {
        viewModeText.innerText = "OBSERVER: 자유비행 (Space: 격자면 붙기)";
        viewModeText.style.color = "#88ff88";
    } else {
        viewModeText.innerText = "OBSERVER: 격자면 이동 (Space: 자유비행)";
        viewModeText.style.color = "#88ff88";
    }
}

export function showMassCount() {
    const count = state.masses.length;
    massCount.innerText = `Masses: ${count} / ${CONFIG.maxMassCount}`;
    if (count >= CONFIG.maxMassCount) {
        btnAdd.disabled = true;
        btnAdd.innerText = "Max Limit Reached";
    } else if (!state.isSpawning) {
        btnAdd.disabled = false;
        btnAdd.innerText = "✚ Add Mass (M)";
    }
}

export function showModel(model) {
    const isFlamm = model === 'FLAMM';
    btnModel.innerText = (isFlamm ? "Model: Flamm" : "Model: Rubber-sheet") + " (C)";
    btnModel.classList.toggle("flamm", isFlamm);
    modelNote.innerText = MODEL_NOTES[model];
}

export function showStudyModel(model) {
    const isFlamm = model === 'FLAMM';
    btnModel.disabled = true;
    btnModel.classList.toggle('flamm', isFlamm);
    btnModel.innerText = isFlamm ? '평가용: 상대론 모드 고정' : '평가용: 뉴턴 모드 고정';
    modelNote.innerText = MODEL_NOTES[model] + ' 이 평가 화면에서는 모델을 전환할 수 없습니다.';
}

export function showInitialModelNote() {
    modelNote.innerText = MODEL_NOTES.RUBBER;
}

export function showPlacementMode() {
    if (placementMode) placementMode.innerText = state.randomPlacement ? "Random" : "Fixed";
}

export function showSpawnMode(active) {
    btnAdd.classList.toggle("active", active);
    if (active) btnAdd.innerText = "Click & Hold on Plane... (M/Esc to cancel)";
    document.body.style.cursor = active ? "crosshair" : "default";
}
