// Frame rate, processing time, GPU time and CPU/GPU use with display sync on (IV.3, Table 3, Fig. 4).
// Targets: Chrome, Firefox, WebKit on macOS; Chrome, Edge, Firefox on Windows; Chrome with sync off.

import { chromium, firefox, webkit } from './browser-runtime.mjs';
import { median, quantile } from './stats.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';

const ROUNDS = Number(process.env.WARPED_ROUNDS || 5), SECONDS = Number(process.env.WARPED_SAMPLE_SECONDS || 5);
const counts = [1, 3, 5], conditions = ['RUBBER', 'FLAMM'].flatMap(model => counts.map(count => ({ model, count })));
const WIN = os.platform() === 'win32';
const OUT = process.env.WARPED_PERF_OUT || (WIN ? 'performance-extended-windows.json' : 'performance-extended.json');
const targets = process.argv.slice(2).length ? process.argv.slice(2) : WIN ? ['chrome', 'edge', 'firefox', 'chrome-novsync'] : ['chrome', 'firefox', 'webkit', 'chrome-novsync'];
const LAUNCH = {
    chrome: [chromium, { channel: 'chrome', headless: false }],
    edge: [chromium, { channel: 'msedge', headless: false }],
    'chrome-novsync': [chromium, { channel: 'chrome', headless: false, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] }],
    firefox: [firefox, { headless: false }],
    webkit: [webkit, { headless: false }],
};
const PROFILE_MARK = { chrome: 'playwright_chromiumdev_profile', edge: 'playwright_chromiumdev_profile', 'chrome-novsync': 'playwright_chromiumdev_profile', firefox: 'playwright_firefoxdev_profile', webkit: 'playwright_webkitdev_profile' };

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

const powershell = cmd => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', maxBuffer: 64 << 20 });
function winProcessTable() {
    const out = powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,UserModeTime,KernelModeTime,CommandLine | ConvertTo-Json -Compress');
    return JSON.parse(out).map(r => ({ pid: r.ProcessId, ppid: r.ParentProcessId, cpu: (Number(r.UserModeTime) + Number(r.KernelModeTime)) / 1e7, cmd: r.CommandLine || '' }));
}
function psTable() {
    if (WIN) return winProcessTable();
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
    return out.split('\n').filter(Boolean).map(l => {
        const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!m) return null;
        const t = m[3].split(/[:.-]/).map(Number);   // [[dd-]hh:]mm:ss.cc
        let sec = 0;
        const parts = m[3].split(':');
        if (parts.length === 2) sec = Number(parts[0]) * 60 + Number(parts[1]);
        else if (parts.length === 3) sec = Number(parts[0].split('-').pop()) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
        void t;
        return { pid: +m[1], ppid: +m[2], cpu: sec, cmd: m[4] };
    }).filter(Boolean);
}
function browserCpuSeconds(mark) {
    const rows = psTable();
    const roots = rows.filter(r => r.cmd.includes(mark)).map(r => r.pid);
    const set = new Set(roots);
    let grew = true;
    while (grew) { grew = false; for (const r of rows) if (!set.has(r.pid) && set.has(r.ppid)) { set.add(r.pid); grew = true; } }
    if (mark.includes('webkit')) for (const r of rows) if (/ms-playwright\/webkit/.test(r.cmd)) set.add(r.pid);
    return { seconds: rows.filter(r => set.has(r.pid)).reduce((s, r) => s + r.cpu, 0), processes: set.size, at: performance.now() };
}
function startWinGpuSampler(seconds) {
    const n = Math.max(1, Math.round(seconds * 2));
    const cmd = `for ($i = 0; $i -lt ${n}; $i++) { $s = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | Measure-Object UtilizationPercentage -Sum).Sum; [Console]::Out.WriteLine([string][double]$s); Start-Sleep -Milliseconds 500 }`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    let out = '';
    child.stdout.on('data', d => out += d);
    const done = new Promise(r => { child.on('close', r); child.on('error', r); });
    return async () => { await done; return out.split(/\r?\n/).map(Number).filter(v => Number.isFinite(v) && v <= 100); };
}
function displayInfo() {
    try {
        if (WIN) return powershell('Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) $($_.CurrentRefreshRate) Hz" }').trim().split(/\r?\n/).join('; ');
        return execFileSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8' }).split('\n').filter(l => /Chipset|Resolution|Displays:|^\s{8}\S.*:$/.test(l)).map(l => l.trim()).join('; ');
    } catch { return null; }
}
function gpuUtilization() {
    if (WIN) return null;
    try {
        const out = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8' });
        const m = out.match(/"Device Utilization %"=(\d+)/);
        return m ? Number(m[1]) : null;
    } catch { return null; }
}

const INIT = () => {
    window.__perf = { on: false, cb: [], ts: [], gpu: [], gpuDisjoint: 0 };
    let gl = null, ext = null;
    const pending = [];
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = getContext.call(this, type, ...rest);
        if (type === 'webgl2' && this.id === 'webgl' && ctx && !gl) {
            gl = ctx; ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            window.__perf.gpuTimer = !!ext;
        }
        return ctx;
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
        if (cb.name !== 'animate') return raf(cb);
        return raf(function (ts) {
            const P = window.__perf;
            if (!P.on) return cb(ts);
            if (ext) {
                while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
                    const q = pending.shift();
                    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) P.gpuDisjoint++;
                    else P.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
                    gl.deleteQuery(q);
                }
            }
            let q = null;
            if (ext && pending.length < 32) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
            const t0 = performance.now();
            cb(ts);
            const t1 = performance.now();
            if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
            P.cb.push(t1 - t0); P.ts.push(ts);
        });
    };
};

async function measureBrowser(target) {
    const [type, opts] = LAUNCH[target];
    const browser = await type.launch(opts);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.addInitScript(INIT);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
    const missing = [];
    page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:8777/index.html?debug', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__warped);
    await page.bringToFront();
    const cdp = target.startsWith('chrome') ? await context.newCDPSession(page) : null;
    if (cdp) await cdp.send('Performance.enable');
    const env = await page.evaluate(() => {
        const canvas = document.getElementById('webgl'), gl = canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { userAgent: navigator.userAgent, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            webgl: gl.getParameter(gl.VERSION), canvas: { width: canvas.width, height: canvas.height }, dpr: devicePixelRatio, gpuTimer: !!window.__perf.gpuTimer };
    });
    console.log(`[${target}]`, env.userAgent, '|', env.renderer, '| GPU timer:', env.gpuTimer);

    let seed = 20261107;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    const runs = [];
    for (let round = 0; round < ROUNDS; round++) {
        for (const { model, count } of shuffle(conditions)) {
            await page.evaluate(({ model, count }) => {
                document.getElementById('btn-reset').click();
                const { state, createMass, massToScale } = window.__warped;
                if (state.model !== model) document.getElementById('btn-toggle-model').click();
                createMass({ x: 0, z: 0 }, massToScale(100), 100);
                for (let i = 1; i < count; i++) { const a = 2 * Math.PI * (i - 1) / (count - 1); createMass({ x: 200 * Math.cos(a), z: 200 * Math.sin(a) }, massToScale(100), 100, { ecc: 0.2 }); }
            }, { model, count });
            await page.waitForTimeout(1900);
            await page.evaluate(() => {
                const { state, computeAcceleration, initGeodesic } = window.__warped;
                state.masses.forEach((m, i) => { const a = i ? 2 * Math.PI * (i - 1) / (state.masses.length - 1) : 0; m.mesh.position.set(i ? 200 * Math.cos(a) : 0, m.mesh.position.y, i ? 200 * Math.sin(a) : 0); m.growth = 1; m.settling = false; m.velocity.set(0, 0, 0); m.geo = null; });
                state.masses.forEach((m, i) => { if (!i) return; const a = 2 * Math.PI * (i - 1) / (state.masses.length - 1); if (state.model === 'FLAMM') { m.presetEcc = 0.2; initGeodesic(m, state.masses[0], 5); } else { const f = computeAcceleration(i); const ar = -(f.ax * Math.cos(a) + f.az * Math.sin(a)); const v = .95 * Math.sqrt(Math.max(ar, 0) * 200); m.velocity.set(-Math.sin(a) * v, 0, Math.cos(a) * v); } });
            });
            await page.waitForTimeout(400);
            const cpu0 = browserCpuSeconds(PROFILE_MARK[target]);
            const m0 = cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])) : null;
            const w0 = performance.now();
            await page.evaluate(() => { const P = window.__perf; P.cb = []; P.ts = []; P.gpu = []; P.gpuDisjoint = 0; P.on = true; });
            const gpuSamples = [];
            const winGpu = WIN ? startWinGpuSampler(SECONDS) : null;
            const until = Date.now() + SECONDS * 1000;
            while (Date.now() < until) { const g = gpuUtilization(); if (g !== null) gpuSamples.push(g); await new Promise(r => setTimeout(r, 500)); }
            const P = await page.evaluate(() => { const P = window.__perf; P.on = false; return { cb: P.cb, ts: P.ts, gpu: P.gpu, gpuDisjoint: P.gpuDisjoint }; });
            const wall = (performance.now() - w0) / 1000;
            const cpu1 = browserCpuSeconds(PROFILE_MARK[target]);
            if (winGpu) gpuSamples.push(...await winGpu());
            const cpuWall = WIN ? (cpu1.at - cpu0.at) / 1000 : wall;
            const m1 = cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])) : null;

            const intervals = P.ts.slice(1).map((t, i) => t - P.ts[i]).filter(v => v > 0);
            const med = median(intervals);
            const run = {
                round: round + 1, model, count,
                fps: intervals.length / ((P.ts.at(-1) - P.ts[0]) / 1000),
                intervalMeanMs: mean(intervals), intervalSdMs: sd(intervals), intervalP50Ms: med,
                intervalP95Ms: quantile(intervals, .95), intervalP99Ms: quantile(intervals, .99),
                lateFrameFraction: intervals.filter(v => v > 1.5 * med).length / intervals.length,
                cbMeanMs: mean(P.cb), cbSdMs: sd(P.cb), cbP95Ms: quantile(P.cb, .95), cbMaxMs: Math.max(...P.cb),
                gpuMeanMs: P.gpu.length ? mean(P.gpu) : null, gpuP95Ms: P.gpu.length ? quantile(P.gpu, .95) : null, gpuSamples: P.gpu.length, gpuDisjoint: P.gpuDisjoint,
                browserCpuPercent: 100 * (cpu1.seconds - cpu0.seconds) / cpuWall, browserProcesses: cpu1.processes,
                gpuUtilPercent: gpuSamples.length ? mean(gpuSamples) : null,
                mainThreadBusyPercent: m0 ? 100 * (m1.TaskDuration - m0.TaskDuration) / wall : null,
                intervals, callbacks: P.cb,
            };
            runs.push(run);
            console.log(`  r${round + 1} ${model.padEnd(6)} ${count}: ${run.fps.toFixed(1)} fps, interval ${run.intervalMeanMs.toFixed(2)}±${run.intervalSdMs.toFixed(2)} ms, cb ${run.cbMeanMs.toFixed(3)} ms, gpu ${run.gpuMeanMs?.toFixed(3) ?? '-'} ms, cpu ${run.browserCpuPercent.toFixed(0)}%, gpuUtil ${run.gpuUtilPercent?.toFixed(0) ?? '-'}%, main ${run.mainThreadBusyPercent?.toFixed(0) ?? '-'}%`);
        }
    }
    await browser.close();
    const rows = conditions.map(({ model, count }) => {
        const sel = runs.filter(r => r.model === model && r.count === count);
        const allI = sel.flatMap(r => r.intervals), allC = sel.flatMap(r => r.callbacks);
        const pick = k => sel.map(r => r[k]).filter(v => v !== null);
        return {
            model, count, frames: allI.length,
            fpsMedianOfRounds: median(pick('fps')), fpsMinRound: Math.min(...pick('fps')), fpsMaxRound: Math.max(...pick('fps')),
            intervalMeanMs: mean(allI), intervalSdMs: sd(allI), intervalP95Ms: quantile(allI, .95), intervalP99Ms: quantile(allI, .99),
            lateFrameFraction: median(pick('lateFrameFraction')),
            cbMeanMs: mean(allC), cbSdMs: sd(allC), cbP95Ms: quantile(allC, .95),
            gpuMeanMs: pick('gpuMeanMs').length ? median(pick('gpuMeanMs')) : null, gpuP95Ms: pick('gpuP95Ms').length ? median(pick('gpuP95Ms')) : null,
            browserCpuPercent: median(pick('browserCpuPercent')), gpuUtilPercent: pick('gpuUtilPercent').length ? median(pick('gpuUtilPercent')) : null,
            mainThreadBusyPercent: pick('mainThreadBusyPercent').length ? median(pick('mainThreadBusyPercent')) : null,
        };
    });
    return { target, env, launch: opts, errors, missing, rows, runs };
}

const idleGpu = []; for (let i = 0; i < 6; i++) { const g = gpuUtilization(); if (g !== null) idleGpu.push(g); await new Promise(r => setTimeout(r, 500)); }
const results = {};
for (const t of targets) {
    results[t] = await measureBrowser(t);
    if (results[t].errors.length) console.log('  errors:', results[t].errors.slice(0, 3));
    if (results[t].missing.length) console.log('  404:', [...new Set(results[t].missing)]);
}
const display = displayInfo();
const meta = { generatedAt: new Date().toISOString(), display, rounds: ROUNDS, seconds: SECONDS, seed: 20261107, viewport: '1280x720, deviceScaleFactor 1',
    setup: 'Central mass at origin, remaining masses on r=200, all masses 100; deterministic motion reset (Newtonian 0.95 v_circ, Schwarzschild e=0.2) before each trial',
    cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryBytes: os.totalmem(), platform: os.platform(), osRelease: os.release(),
    idleGpuUtilPercent: idleGpu.length ? mean(idleGpu) : null,
    physicsSha256: createHash('sha256').update(readFileSync(new URL('../physics/geodesic.mjs', import.meta.url))).digest('hex'),
    mainJsSha256: createHash('sha256').update(readFileSync(new URL('../main.js', import.meta.url))).digest('hex'),
    notes: WIN ? 'browserCpuPercent: CPU time of the browser process tree (Win32_Process) / wall time (100% = one core). gpuUtilPercent: sum of 3D-engine utilization over all processes (GPU Engine performance counters). Quantiles: type 7.'
        : 'browserCpuPercent: CPU time of the browser process tree / wall time (100% = one core). gpuUtilPercent: system-wide IOAccelerator Device Utilization. Quantiles: type 7.' };
let previous = {};
try { previous = JSON.parse(readFileSync(new URL(`./results/${OUT}`, import.meta.url), 'utf8')).results || {}; } catch {}
writeFileSync(new URL(`./results/${OUT}`, import.meta.url), JSON.stringify({ meta, results: { ...previous, ...results } }));
console.log(`Saved ${OUT}`);
for (const [t, r] of Object.entries(results)) {
    console.log(`\n== ${t}: ${r.env.renderer}`);
    for (const row of r.rows) console.log(`${row.model.padEnd(6)} ${row.count}  fps ${row.fpsMedianOfRounds.toFixed(1)} [${row.fpsMinRound.toFixed(1)}, ${row.fpsMaxRound.toFixed(1)}]  int ${row.intervalMeanMs.toFixed(2)}±${row.intervalSdMs.toFixed(2)} p95 ${row.intervalP95Ms.toFixed(2)} p99 ${row.intervalP99Ms.toFixed(2)}  late ${(100 * row.lateFrameFraction).toFixed(2)}%  cb ${row.cbMeanMs.toFixed(3)}±${row.cbSdMs.toFixed(3)} p95 ${row.cbP95Ms.toFixed(3)}  gpu ${row.gpuMeanMs?.toFixed(3) ?? '-'}  cpu ${row.browserCpuPercent.toFixed(0)}%  gpuUtil ${row.gpuUtilPercent?.toFixed(0) ?? '-'}%  main ${row.mainThreadBusyPercent?.toFixed(0) ?? '-'}%`);
}
