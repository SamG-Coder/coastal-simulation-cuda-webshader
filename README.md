# Coastal simulation with CUDA WebShader

**A CUDA WebShader port of [coastal-simulation by iamtechartist](https://github.com/iamtechartist/coastal-simulation).**
The original project provides the coastal scene, shallow-water equations,
materials, assets and overall experience. This repository builds on that work;
it is not the original implementation. Original MIT attribution is retained.

**[Play the live demo](https://samg-coder.github.io/coastal-simulation-cuda-webshader/)** ·
[Original project](https://github.com/iamtechartist/coastal-simulation) ·
[Original demo](https://iamtechartist.github.io/coastal-simulation/) ·
[CUDA WebShader](https://github.com/SamG-Coder/cuda-webshader)

This port runs simulation, surface reconstruction and dynamic effects through
SamG-Coder's CUDA WebShader compiler and WebGPU runtime. CUDA writes directly to
resources shared with the Three.js renderer, keeping simulation fields on the
GPU. The original coastline, lighting, materials, navigation and controls remain.

Port additions include GPU-resident simulation/render data, CUDA reconstruction,
spray and diagnostics, a free-fly camera, and an on-screen FPS counter.
See [CREDITS.md](CREDITS.md) for source revisions and component licenses.

## Run locally

```sh
npm install
npm start
```

Open http://localhost:5174 in a browser with WebGPU support. CUDA WebShader is
the default simulation backend. No CUDA Toolkit, native server or build step is
required: the bundled compiler translates `src/coastal-kernels.cu` and
`src/coastal-render.cu` to WGSL at startup. Serve over localhost or HTTPS.

- `?profile` exposes CPU submission timings, GPU resource counters, and small
  diagnostic summaries. It also enables Three.js rendering timestamps.
- `?solver=cpu` explicitly selects the original WebAssembly/JavaScript solver.
- `?solver=cpu&webgl=1` also selects the WebGL 2 renderer for compatibility.
- `?solver=legacy` retains the GPU solver with the previous CPU reconstruction
  and readback pipeline for comparison.
- `window.saltreach.diagnostics.solver` identifies the active simulation backend.

CUDA initialization failures are reported in the UI, with an explicit link to
compatibility mode. The app does not silently substitute CPU execution.

## Fly camera

Drag with either mouse button to look. WASD (or arrow keys) flies forward/back
along the view direction and strafes left/right. E ascends, Q descends, and
either Shift key boosts speed from 6 to 24 metres per second. Scroll moves along
the view direction. Movement stops immediately on release; manual flight has
no collision, terrain height tracking or altitude limits. Touch controls include
Up/Down buttons. C selects a preset view, Space pauses the water, and H hides
the controls. FPS and frame time remain visible in the upper-left corner.

## Port details

The 19 CUDA entry points cover:

- Procedural terrain/obstacle grid initialization, boundary coefficients and
  the 512 × 512 material-noise texture.
- Condition smoothing, incoming wave rows, staggered velocities, positive
  volume transport, radiation boundaries, foam, wet sand and film decay.
- Dry shoreline surface reconstruction, connected-water normals, and packing
  surface/material/flow fields into GPU buffers with aligned row pitches.
- Rock wetness persistence, spray emission, ballistic motion, size and fade.
- Hierarchical diagnostic reductions.

The 60 Hz fluid and 30 Hz advection schedules are preserved. Dispatch boundaries
order dependent cell operations. Fixed bind groups are cached, and dependent
steps, reconstruction, spray and GPU texture copies are batched. The renderer
interpolates between two sets of GPU textures at display frequency.

`src/cuda-solver.js` owns compute state. `src/resident-coast.js` schedules fixed
steps on the renderer's device. `src/gpu-interop.js` is the small adapter pinned
to Three r185: it shares storage buffers and copies CUDA output directly into
renderer-owned textures. No simulation field, reconstructed surface, particle
matrix or alpha array is read back or uploaded in the normal frame path.

If the baked initial state is missing, procedural initialization and all 2,160
warm-up steps run through CUDA. GPU material noise replaces the CPU pixel loop.
A 32-byte diagnostic summary is read once at startup; profiling mode reads one
additional summary per second. Tests and explicit inspection may read larger
buffers. `sync()` is an explicit testing/export method, never a render dependency.

JavaScript handles browser events, camera/navigation, the scene graph, initial
static mesh construction, scalar UI mirrors and command submission. Three.js
continues GPU rasterization and material shading. This uses CUDA source compiled
to WebGPU; it does not run native NVIDIA CUDA in the browser.

Arithmetic uses f32 rather than the CPU solver's double intermediates. GPU rock
initialization differed by at most 0.000152 m in the tested grid; material noise
differed by at most one 8-bit channel level. Spray uses deterministic per-rock
seeds and 24 slots per rock (336 total), retaining the original emission criteria
and motion equations while removing the global CPU particle ring. Individual
particles are therefore not pixel-identical to the original random sequence.

The compiler/runtime source is vendored under `vendor/cuda-webshader` with its
license and pinned provenance, so this repository can be served independently
of the local CUDA WebShader checkout. Three.js remains at the upstream revision.

## Validation

```sh
npm test          # Compile all 19 CUDA entries
npm run test:gpu  # Numerical, conservation and stability tests in Edge WebGPU
npm run test:app  # Texture interop, scene, controls, errors and cold-start paths
npm run bench     # Completed-GPU simulation-to-render pipeline comparison
npm run bench:app # Exploratory browser-paced FPS measurements
```

The browser tests use Playwright and an installed Microsoft Edge. Numerical
tests compare every value in all nine output fields with the original JS
solver, including partial workgroups, resting water, a closed domain, wet/dry
fronts, obstacles, changed controls, and the complete 241 × 401 baked shoreline.
A separate GPU run checks 30 simulated seconds from a cold start. Tests also
compare reconstructed render fields, procedural initialization, material noise,
spray motion and GPU diagnostic reductions. The application test verifies exact
texture-copy contents and deliberately throws if CPU simulation/packing or
full-state synchronization is used by the resident render path.

Reports are in `reports/gpu-validation.json` and `reports/app-validation.json`.
The application check also writes `reports/coastal-cuda.png` (not tracked).
Tests were run on a hardware NVIDIA Blackwell adapter. In the full-grid
60-step comparison using identical initial arrays, maximum depth error was
approximately 2.7e-6 metres. GPU reconstruction/packing agreed with the CPU
implementation within 6e-8; the actual renderer textures matched CUDA output
exactly. CPU and GPU initialization are tested separately.

## Performance

The controlled benchmark processes two 60 Hz solver steps and produces all
three render textures, waiting for GPU completion after every sample. Three
alternating-order rounds each have 10 warm-up updates and 100 measured updates.
Drawing is paused to isolate the simulation-to-render pipeline.

| Pipeline | Mean completed update |
| --- | ---: |
| GPU solver + CPU readback/reconstruction/upload | 6.874 ms |
| GPU-resident simulation, reconstruction and copies | 3.179 ms |

This is **2.16× faster**, or approximately **54% less time per update**. The new
path also includes GPU spray work; the reference omits CPU spray, favouring the
reference. At 30 publications/s, removing the nine-field readback and three-field
upload avoids approximately 244 MB/s of host field transfers on this grid.

Raw samples and methodology are saved in `reports/pipeline-performance.json`.
This measures this machine's pipeline cost, not an overall FPS multiplier or
native CUDA parity. Early browser FPS measurements varied with frame pacing;
they are not used for the performance claim. `submissionMeanMs` is CPU command
submission time, not GPU execution time. The zero `packMs`, `reconstructionMs`
and `readbackMs` in resident diagnostics refer to eliminated CPU field work;
the CUDA computation still has a GPU cost measured by the pipeline benchmark.

The original project's MIT license and attribution are preserved in `LICENSE`.

## GitHub Actions and Pages

The `Validate and deploy Pages` workflow runs on pushes to `main`, pull requests
and manual dispatch. It installs locked dependencies, compiles all CUDA entry
points, and builds the static site. Successful runs on `main` deploy to GitHub
Pages using the `github-pages` environment and GitHub's official Pages actions.
Pull requests validate without deploying. Hardware GPU checks remain local;
the hosted Ubuntu runner does not substitute a CPU check for hardware validation.

Run `npm run build` to generate `dist/`. Deployment includes only the website,
runtime source and attribution files; development dependencies, tests and local
reports are excluded. In repository Settings → Pages, the source is GitHub Actions.
