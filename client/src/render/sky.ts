import * as THREE from 'three'

// Procedural sky (no image needed): a dome with a horizon -> zenith gradient + a sun glow.
// The horizon colour is also the fog colour so distant objects blend into the sky with no hard horizon line.
export const SKY_HORIZON = 0xbcd2e4
const SKY_ZENITH = 0x3f78b8
const SKY_RADIUS = 200   // must be smaller than camera.far

export function createSky(scene: THREE.Scene, sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      sunDir: { value: sunDir.clone().normalize() },
      night: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform float night; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18) * (1.0 - night);
        if (night > 0.5) {   // night: dark gradient + a few stars (random 3D grid cells) + a faint moon glow
          c = mix(vec3(0.02, 0.03, 0.06), vec3(0.0, 0.005, 0.02), pow(h, 0.5));
          vec3 q = normalize(vDir) * 280.0;
          vec3 g = floor(q);
          float star = step(0.994, hash(g)) * smoothstep(0.05, 0.4, h) * (1.0 - smoothstep(0.07, 0.16, length(fract(q) - 0.5)));   // small dot in the middle of the grid cell
          c += vec3(0.8, 0.85, 1.0) * star;
          c += vec3(0.35, 0.42, 0.6) * (pow(s, 900.0) * 1.0 + pow(s, 14.0) * 0.06);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), mat)
  dome.frustumCulled = false
  dome.renderOrder = -1
  scene.add(dome)
  return {
    update(camPos: THREE.Vector3): void { dome.position.copy(camPos) },
    setNight(on: boolean): void { mat.uniforms.night!.value = on ? 1 : 0 },
  }
}
