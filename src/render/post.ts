// The broadcast look: bloom, tone mapping and a grade, on the tiers that can afford them.
//
// Without a post chain the renderer tone-maps straight to the canvas, and nothing in the
// frame can be brighter than white — which is fine for grass and wrong for everything that
// is meant to be LIGHT: a floodlight bank at night, a fire ball's trail, the halo round a
// lightning ball. Bloom is how a display says "brighter than the screen can show", and it
// is most of the difference between a lit scene and a scene with bright colours in it.
//
// The chain is HDR throughout (half-float targets): the scene renders linear, bloom picks
// out only what is over the threshold — emissive things, never the sunlit grass — and the
// OutputPass does the tone mapping and sRGB conversion the renderer would have done. The
// grade runs last, on display values, which is where a colourist would put it.
//
// Multisampled, because rendering into a target loses the canvas's own antialiasing, and a
// pitch full of thin white lines without AA shimmers the moment the camera pans.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * A light broadcast grade: a touch of contrast and saturation, a warm lift in the
 * highlights and a soft vignette. Televised football is graded bright and clean — this is
 * not a film look, and the numbers stay small on purpose.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.22 },
    uSaturation: { value: 1.07 },
    uContrast: { value: 1.05 },
    uWarm: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarm;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += vec3(uWarm, uWarm * 0.4, -uWarm * 0.6) * smoothstep(0.5, 1.0, l);
      vec2 q = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      // Dither: half a code value of noise, which breaks the banding an 8-bit display
      // otherwise shows in a smooth sky gradient.
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(col * v, 0.0, 1.0), c.a);
    }`,
};

/** Bloom threshold in daylight, linear HDR. See the constructor. */
const DAY_THRESHOLD = 2.6;

export class PostChain {
  readonly #composer: EffectComposer;
  readonly #bloom: UnrealBloomPass;
  readonly #render: RenderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
    });
    this.#composer = new EffectComposer(renderer, target);
    this.#render = new RenderPass(scene, camera);
    this.#composer.addPass(this.#render);
    // The threshold is well above 1. Under the afternoon key light a white shirt in full sun comes out
    // near 2 in linear HDR, and at 1.0 every white shirt in the crowd bloomed — a stand of
    // twenty thousand sparkles. Emissive things are pushed above it on purpose.
    this.#bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.42, DAY_THRESHOLD);
    this.#composer.addPass(this.#bloom);
    this.#composer.addPass(new OutputPass());
    this.#composer.addPass(new ShaderPass(GradeShader));
  }

  /** Night matches bloom harder: floodlights against a black sky are what bloom is FOR. */
  setNight(night: boolean): void {
    this.#bloom.strength = night ? 0.62 : 0.5;
    this.#bloom.threshold = night ? 1.4 : DAY_THRESHOLD;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.#composer.setPixelRatio(pixelRatio);
    this.#composer.setSize(w, h);
  }

  render(dt: number): void {
    this.#composer.render(dt);
  }

  dispose(): void {
    this.#composer.renderTarget1.dispose();
    this.#composer.renderTarget2.dispose();
    this.#bloom.dispose();
    this.#composer.dispose();
  }
}
