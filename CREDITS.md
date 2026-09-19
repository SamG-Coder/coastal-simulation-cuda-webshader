# Credits and provenance

## Original project

This is a port of **[coastal-simulation](https://github.com/iamtechartist/coastal-simulation)**
by **[iamtechartist](https://github.com/iamtechartist)** (Techartist).

The original scene, coastal simulation equations, materials, procedural assets,
and original initial state come from that project. The current port regenerates
its initial state on CUDA for its revised rock geometry and waves. The starting upstream commit is
[`2e95e1a3e757ca1268247417dee01606e5e3d55c`](https://github.com/iamtechartist/coastal-simulation/commit/2e95e1a3e757ca1268247417dee01606e5e3d55c).
The original Git history and MIT license are retained. See [LICENSE](LICENSE).

Original live demo: https://iamtechartist.github.io/coastal-simulation/

## Port

The port by [SamG-Coder](https://github.com/SamG-Coder) adds CUDA WebShader compute,
GPU-resident surface reconstruction and render fields, GPU spray, validation and
benchmark tooling, direct free-flight controls, an FPS display, and Pages deployment.
The enhanced GPU model adds momentum advection, transported breaking turbulence,
directional short-wave detail and updated water highlights. CPU reference code is
retained only in development tests and is excluded from the deployed application.
Port additions are provided under the MIT license as well.

## CUDA WebShader

Compiler/runtime: [SamG-Coder/cuda-webshader](https://github.com/SamG-Coder/cuda-webshader).
Vendored from revision `c272bb782f8458761af2894e8771517f64ecdae6`.
See [the component license](vendor/cuda-webshader/LICENSE) and
[provenance](vendor/cuda-webshader/PROVENANCE.md).

## Three.js

The upstream vendored Three.js r185 files retain their MIT license headers,
copyright © 2010–2026 Three.js authors. Project: https://github.com/mrdoob/three.js.

The browser executes generated WGSL through WebGPU. This port is not an official
NVIDIA project and does not run the native CUDA runtime in the browser.
