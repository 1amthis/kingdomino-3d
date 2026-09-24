// Shared materials. Flat-shaded vertex-colour materials keep the diorama look cohesive;
// small shader injections add wind, shimmering water and night-time glow.
import * as THREE from 'three';
import { makeWaterNormal, makeTileWoodTexture } from './textures.js';

export const uniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uNight: { value: 0 },
};

function injectWind(mat, strength = 1) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = max(position.y, 0.0);
          float k = h * h * ${(0.35 * strength).toFixed(3)} * uWind;
          float ph = wp.x * 2.3 + wp.z * 1.7;
          transformed.x += sin(uTime * 1.7 + ph) * k * 0.6 + sin(uTime * 3.1 + ph * 1.3) * k * 0.25;
          transformed.z += cos(uTime * 1.3 + ph * 0.8) * k * 0.45;
        }`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength;
  return mat;
}

export const M = {};

export function createMaterials() {
  M.flat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });
  M.sway = injectWind(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0 }), 1);
  M.swaySoft = injectWind(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }), 6);

  M.wood = new THREE.MeshStandardMaterial({ map: makeTileWoodTexture(), color: 0xf0dcc0, roughness: 0.55, metalness: 0 });
  M.woodDark = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.7 });

  M.gold = new THREE.MeshStandardMaterial({ color: 0xffc445, metalness: 1, roughness: 0.3, emissive: 0x3a2400, emissiveIntensity: 0.25, envMapIntensity: 1.6 });
  M.goldDull = new THREE.MeshStandardMaterial({ color: 0xd9a23a, metalness: 0.9, roughness: 0.4 });
  M.ruby = new THREE.MeshPhysicalMaterial({ color: 0xd4103a, roughness: 0.05, metalness: 0, transmission: 0.2, clearcoat: 1, emissive: 0x400010, emissiveIntensity: 0.6 });
  M.sapphire = new THREE.MeshPhysicalMaterial({ color: 0x1e5bff, roughness: 0.05, clearcoat: 1, emissive: 0x001040, emissiveIntensity: 0.5 });

  const waterNormal = makeWaterNormal(256, 3);
  const waterNormal2 = makeWaterNormal(256, 11);
  M.waterNormal = waterNormal;
  M.waterNormal2 = waterNormal2;
  M.water = new THREE.MeshPhysicalMaterial({
    color: 0x2f8fd0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.78,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.45, 0.45), clearcoat: 1, clearcoatRoughness: 0.08,
    clearcoatNormalMap: waterNormal, clearcoatNormalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: 3, specularIntensity: 1, ior: 1.33,
  });
  M.swampWater = new THREE.MeshPhysicalMaterial({
    color: 0x3d4a23, roughness: 0.18, transparent: true, opacity: 0.93,
    normalMap: waterNormal2, normalScale: new THREE.Vector2(0.18, 0.18), clearcoat: 0.8,
  });

  // Emissive props: lanterns, windows, crystals, fireflies. Brightened at night via uNight.
  const glow = (hex, day, night) => {
    const m = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: day, roughness: 0.4 });
    m.userData.glow = { day, night };
    return m;
  };
  M.lantern = glow(0xffa53a, 1.2, 6);
  M.window = glow(0xffc766, 0.15, 4.5);
  M.crystal = new THREE.MeshPhysicalMaterial({ color: 0x7fe6ff, emissive: 0x2ab8ff, emissiveIntensity: 0.8, roughness: 0.1, clearcoat: 1, flatShading: true });
  M.crystal.userData.glow = { day: 0.8, night: 3.5 };
  M.crystalPink = new THREE.MeshPhysicalMaterial({ color: 0xff9ad8, emissive: 0xff3ab0, emissiveIntensity: 0.6, roughness: 0.1, clearcoat: 1, flatShading: true });
  M.crystalPink.userData.glow = { day: 0.6, night: 3 };
  M.firefly = new THREE.MeshBasicMaterial({ color: 0xd8ff6a, transparent: true, opacity: 0, depthWrite: false });

  M.back = new THREE.MeshStandardMaterial({ color: 0x1a2a5a, roughness: 0.6 });
  M.ghostOk = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.35, depthWrite: false });
  M.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.35, depthWrite: false });
  return M;
}

export function playerMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.3 });
}

export function flatPlayerMaterial(hex) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, flatShading: true });
}

export function updateMaterials(time, night) {
  uniforms.uTime.value = time;
  uniforms.uNight.value = night;
  M.waterNormal.offset.set(time * 0.012, time * 0.007);
  M.waterNormal2.offset.set(-time * 0.004, time * 0.003);
  for (const m of [M.lantern, M.window, M.crystal, M.crystalPink]) {
    const g = m.userData.glow;
    m.emissiveIntensity = g.day + (g.night - g.day) * night;
  }
  M.firefly.opacity = Math.max(0, night * 1.1 - 0.1);
}
