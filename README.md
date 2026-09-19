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
GPU. The original coastline and scene are retained, with enhanced wave motion,
water shading and free-flight controls.

Port additions include GPU-resident simulation/render data, momentum advection,
persistent breaking turbulence, directional short waves, CUDA reconstruction,
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
- `window.saltreach.diagnostics.solver` identifies the active simulation backend.

**WebGPU is required. There is no CPU, WebAssembly, WebGL or legacy readback
fallback.** Old solver query parameters do not change the backend. GPU startup
failures show an error; they never switch execution to the CPU. CPU reference
code lives only under `tests/reference/`, which is excluded from deployment.

## Enhanced waves

- CUDA advects staggered face velocities before pressure and conservative
  volume transport, allowing currents and backwash to carry momentum.
- Compressive, steep fronts and rock impacts generate a bounded turbulence
  reservoir. It travels with the flow, dissipates over time, increases drag,
  and feeds persistent whitewater after a breaker has passed.
- Eight directional short-wave bands are evaluated in CUDA at field publication
  time. Deep-water gravity-wave dispersion sets their speeds; a second harmonic
  sharpens crests. Detail fades in shallow water, beneath foam, and at grid edges.
- Water uses roughness-dependent GGX sun highlights with derivative filtering,
  brighter foam and stronger backlit crest colour.
- Rocky surf uses stronger incoming swells and short-wave chop, with connected
  foam filaments and clear-water gaps. Fractured rock geometry is mirrored in
  the CUDA obstacle field, and wet surfaces darken around the waterline.
- At exposed rocks, CUDA extrapolates the nearby water surface through the
  hidden solid interior. Raster depth resolves the precise rock intersection,
  avoiding raised water triangles and coarse grid-shaped cutouts at cliff faces.
- Impact-driven spray has 384 slots per rock (5,376 total), split into ballistic
  droplets, dense spray fragments and expanding mist with drag. Launch strength
  follows incoming speed and water rise; still water does not emit plumes.

The opening **Rocky Surf** viewpoint looks out over the main rock group. The
original viewpoints remain in the selector, and manual flight is unchanged.

The main model remains a 2D shallow-water heightfield, not an overturning 3D
fluid simulation. The short waves are rendering detail and do not add physical
water volume. Turbulence/foam coupling is a visual approximation. The techniques
draw on [Bridson's fluid simulation notes](https://www.cs.ubc.ca/~rbridson/fluidsimulation/)
and [NVIDIA's water rendering chapter](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models).

## Fly camera

Drag with either mouse button to look. WASD (or arrow keys) flies forward/back
along the view direction and strafes left/right. E ascends, Q descends, and
either Shift key boosts speed from 6 to 24 metres per second. Scroll moves along
the view direction. Movement stops immediately on release; manual flight has
no collision, terrain height tracking or altitude limits. Touch controls include
Up/Down buttons. C selects a preset view, Space pauses the water, and H hides
the controls. FPS and frame time remain visible in the upper-left corner.

## Port details

The 21 CUDA entry points cover:

- Procedural terrain/obstacle grid initialization, boundary coefficients and
  the 512 × 512 material-noise texture.
- Condition smoothing, incoming wave rows, staggered velocities, positive
  volume transport, radiation boundaries, foam, wet sand and film decay.
- Momentum advection, transported breaking turbulence and directional surface detail.
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
initialization differed by at most 0.000073 m in the tested grid; material noise
differed by at most one 8-bit channel level. Spray uses deterministic per-rock
seeds and bounded rings. Its three particle layers, impact thresholds and launch
speeds extend the original small droplet effect; they are visual effects rather
than a 3D volume-conserving fluid solver.

The bundled `initial-state.bin.gz` is now regenerated for the current fractured
rocks and swell amplitudes with `node scripts/bake-state.mjs`. That development
tool runs 36 seconds on the CUDA solver, checks stability, and exports the nine
fields once. It is not deployed and does not introduce a runtime CPU fallback.

The compiler/runtime source is vendored under `vendor/cuda-webshader` with its
license and pinned provenance, so this repository can be served independently
of the local CUDA WebShader checkout. Three.js remains at the upstream revision.

## Validation

```sh
npm test          # Audit deployed imports and compile all 21 CUDA entries
npm run test:gpu  # Numerical, conservation and stability tests in Edge WebGPU
npm run test:app  # Texture interop, scene, controls, errors and cold-start paths
npm run bench     # Completed-GPU simulation-to-render pipeline comparison
npm run bench:realism # Previous versus enhanced GPU model, completed updates
npm run bench:app # Exploratory browser-paced FPS measurements
```

The browser tests use Playwright and an installed Microsoft Edge. Reference-mode
tests compare every value in all nine output fields with the original JS
solver, including partial workgroups, resting water, a closed domain, wet/dry
fronts, obstacles, changed controls, and the complete 241 × 401 baked shoreline.
A separate GPU run checks 30 simulated seconds from a cold start. Tests also
compare reconstructed render fields, procedural initialization, material noise,
spray motion and GPU diagnostic reductions. The application test verifies exact
texture-copy contents and deliberately throws if CPU simulation/packing or
full-state synchronization is used by the resident render path. Enhanced-model
tests independently check equilibrium, momentum transport, volume conservation,
turbulence persistence/decay, drying, and render detail without changing depth.
Application checks also verify that no CPU modules load, old fallback links stay
on CUDA, and unavailable WebGPU fails without creating a fallback renderer.

Reports are in `reports/gpu-validation.json` and `reports/app-validation.json`.
The application check also writes `reports/coastal-cuda.png` (not tracked).
Tests were run on a hardware NVIDIA Blackwell adapter. In the full-grid
60-step comparison using identical initial arrays, maximum depth error was
approximately 2.9e-6 metres. GPU reconstruction/packing agreed with the CPU
implementation within 6e-8; the actual renderer textures matched CUDA output
exactly. CPU and GPU initialization are tested separately.

## Performance

The current enhanced model averaged **3.322 ms** per completed update versus **3.253 ms**
for reference physics on the same GPU-resident scene in three alternating-order rounds on this
machine. The 0.069 ms difference is small compared with run-to-run variation;
this is evidence of similar pipeline cost, not a guaranteed FPS improvement.
Both paths perform two physics steps, reconstruction, spray and three texture
copies with drawing paused. Neither transfers evolving fields to the CPU.
See `reports/realism-performance.json` and `npm run bench:realism`.

The following earlier benchmark isolates the original port's removal of field
readback. Its CPU reference now exists only in development tooling:

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
