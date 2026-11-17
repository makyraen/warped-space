// Tunable constants. Lengths are in screen units unless noted.
export const CONFIG = {
    planeSize: 1000,
    maxMassCount: 5,          // also the size of the uniform arrays in the vertex shader
    maxMassValue: 200,
    minMassValue: 20,
    scaleBase: 5.0,           // sphere radius at mass 0
    scalePerMass: 0.2,
    chargeRatePerSec: 50.0,   // mass added per second while the pointer is held
    gridScale: 100.0,
    depthColorScale: 70.0,    // depth at which the grid colour is ~63% of the way to orange
    rubberPullStrength: 1.0,  // grid-line pull in the rubber-sheet view (0 = off)
    bloomThreshold: 0.55, bloomStrength: 0.9, bloomRadius: 0.5,

    // Newtonian mode
    gravityK: 100.0,
    epsilon: 80.0,            // Plummer softening length
    physicsSpeedScale: 100.0,

    // Schwarzschild mode
    massToM: 0.05,            // simulation mass -> geometric mass M
    embedR0: 490.0,           // Flamm depth is zero at this radius
    massLimit: 340.0,         // masses stay inside this radius (the grid fades out beyond it)
    geodesicEccMin: 0.1, geodesicEccMax: 0.35,
    geodesicSepMargin: 1.0,   // keep p at least this many M outside the separatrix (6 + 2e)M
    geodesicMinRFactor: 3.5,  // lower bound (in M) for the L_circ formula, which needs r > 3M
    geodesicHorizonPad: 2.5,  // inner clamp radius in M; capture is not modelled
    geodesicTimeScale: 260.0, // proper time per second of display time

    // Fixed-step integration
    physicsTimeStep: 1 / 120,
    maxPhysicsStepsPerFrame: 8,
    maxFrameTime: 0.25,       // longer frames (e.g. after a hidden tab) are cut to this

    // Observer (first-person view, Newtonian movement in both modes)
    userMass: 20,
    userHeightOffset: 15,
    observerThrust: 55.0,
    observerGravityScale: 0.4,
    observerFriction: 1.1,
    observerHeightSmooth: 6.0,
    observerLimit: 460.0,
    observerArrivalPad: 45.0,
    observerFreeThrust: 110.0,

    // Presets (number keys) and random placement (R)
    presetRadius: 200.0,
    presetMass: 100.0,
    presetEcc: 0.2,
    presetSpeedFactor: 0.95,  // fraction of the circular speed in the Newtonian mode
    randomRadiusMin: 90.0, randomRadiusMax: 300.0
};

// Mass and sphere radius are converted only through this pair.
export const massToScale = (mass) => CONFIG.scaleBase + mass * CONFIG.scalePerMass;
export const scaleToMass = (scale) => (scale - CONFIG.scaleBase) / CONFIG.scalePerMass;
