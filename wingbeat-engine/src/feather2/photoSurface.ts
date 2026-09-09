import * as THREE from 'three';
import type { Anatomy } from './anatomy';

/** Independent, texture-bearing micro-quads. No connected triangles span two
 * particles: each instance carries its original source patch through flight. */
export function createPhotoSurface(anatomy: Anatomy, source: string, pointGeometry: THREE.BufferGeometry,
  uniforms: Record<string, THREE.IUniform>, vertexShader: string, fragmentShader: string,
  maxAnisotropy: number, onError: () => void) {
  const data = anatomy.photoPoints;
  if (!data) return null;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5,-.5,0, .5,-.5,0, -.5,.5,0, .5,.5,0],3));
  geometry.setIndex([0,1,2,2,1,3]);
  geometry.instanceCount = anatomy.count;
  for (const [name, attribute] of Object.entries(pointGeometry.attributes)) {
    geometry.setAttribute(name === 'position' ? 'aRest' : name,
      new THREE.InstancedBufferAttribute(attribute.array, attribute.itemSize));
  }
  geometry.setAttribute('aPhotoUV', new THREE.InstancedBufferAttribute(data.uv, 2));
  const maskData = anatomy.photoSurface;
  const mask = maskData ? new THREE.DataTexture(maskData.mask, maskData.width, maskData.height, THREE.RedFormat) : null;
  if (mask) { mask.flipY = true; mask.minFilter = mask.magFilter = THREE.LinearFilter; mask.needsUpdate = true; }
  let disposed = false, ready = false;
  const texture = new THREE.TextureLoader().load(source, () => {
    if (disposed) { texture.dispose(); return; }
    ready = true;
  }, undefined, () => { if (!disposed) onError(); });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  const declarations = `
    attribute vec3 aRest;
    attribute vec2 aPhotoUV;
    uniform vec2 uViewport;
    uniform float uWorldPixel;
    uniform float uFootprint;
    uniform float uTail;
    uniform float uParticleShape;
    uniform float uConnection;
    varying float vOrganicPulse;
    varying vec2 vPatch;
    varying vec2 vPhotoUV;
  `;
  let vertex = vertexShader.replace(/\bposition\b/g, 'aRest');
  const closing = vertex.lastIndexOf('}');
  vertex = vertex.slice(0, closing) + `
    vPatch = position.xy;
    vPhotoUV = aPhotoUV;
    float patchScale = max(0.01, localSize * groupSize * patternSize * partSize);
    float pixelSize = uWorldPixel * uFootprint * patchScale
      * projectionMatrix[1][1] * uViewport.y * 0.5 / max(0.02, -mv.z);
    // Instanced quads avoid the hardware point-size limit during macro inspection.
    vec2 corner = position.xy;
    vOrganicPulse = sin(uTime * 1.2 - aRest.y * 9.0 - abs(aRest.x) * 4.0);
    if (uParticleShape > 5.5 && uParticleShape < 8.5 && part > 1.5) {
      // Round in screen space at every viewing angle, even with Connection on.
      corner *= 1.0 + uConnection * 0.7;
    } else if (uParticleShape > 0.5 && part > 1.5) {
      // Orient the overlapping stems with the projected anatomical barb.
      vec2 tangent = (modelViewMatrix * vec4(aBarb.xy, 0.0, 0.0)).xy;
      tangent = dot(tangent, tangent) > 0.00001 ? normalize(tangent) : vec2(0.0, 1.0);
      float reach = 1.0 + uConnection * (uParticleShape > 1.5 && uParticleShape < 2.5 ? 3.6 : 1.8) + uTail * 1.5;
      corner *= vec2(reach, 1.0 + 0.25 * uConnection + 0.08 * vOrganicPulse);
      corner = tangent * corner.x + vec2(-tangent.y, tangent.x) * corner.y;
    }
    gl_Position.xy += corner * pixelSize * 2.0 / uViewport * gl_Position.w;
  ` + vertex.slice(closing);
  const fragment = fragmentShader
    .replace(/vec2 q = gl_PointCoord - 0.5;[\s\S]*?vec3 col = pow\(max\(vColor, vec3\(0.0\)\), vec3\(2.2\)\);/, `
    vec2 sourceUV = vPhotoUV + uPhotoBasis * (vPatch * uFootprint);
    vec4 photo = texture2D(uPhoto, sourceUV);
    float squareEdge = 1.0 - smoothstep(0.36, 0.5, max(abs(vPatch.x), abs(vPatch.y)));
    float fibreEdge = exp(-dot(vPatch * vec2(1.0, 2.2), vPatch * vec2(1.0, 2.2)) * 7.0) * squareEdge;
    float silhouette = mix(squareEdge, fibreEdge, uBlend * 0.75);
    float coverage = photo.a * texture2D(uPhotoMask, sourceUV).r;
    float sheen = 0.0;
    float sphereLight = 1.0;
    vec3 sphereTint = vec3(1.0);
    vec3 materialNormal = normalize(vec3(vPatch * 2.0, 0.8));
    if (uParticleShape > 0.5 && vPart > 1.5) {
      vec2 q = vPatch;
      // Smooth signed-distance unions join stems to buds without square edges.
      float radius = 0.24 + 0.03 * vOrganicPulse;
      float d = length(q * vec2(1.0, 1.25)) - radius;
      if (uParticleShape > 1.5 && uParticleShape < 2.5) {
        q.y += sin(q.x * 8.0 + vOrganicPulse) * 0.035;
        d = capsule(q, vec2(-0.46, 0.0), vec2(0.46, 0.0), 0.035 + uConnection * 0.025);
        d = organicUnion(d, capsule(q, vec2(-0.22, 0.0), vec2(-0.02, 0.28), 0.044), 0.065);
        d = organicUnion(d, capsule(q, vec2(0.02, 0.0), vec2(0.22, -0.28), 0.044), 0.065);
        d = organicUnion(d, length((q - vec2(-0.02, 0.27)) * vec2(1.4, 1.0)) - 0.09, 0.05);
        d = organicUnion(d, length((q - vec2(0.22, -0.27)) * vec2(1.4, 1.0)) - 0.09, 0.05);
      } else if (uParticleShape < 1.5) {
        d = organicUnion(d, capsule(q, vec2(-0.38, 0.0), vec2(0.38, 0.0), 0.06 + uConnection * 0.06), 0.12);
      }
      if (uParticleShape > 2.5 && uParticleShape < 3.5) d = max(abs(q.x), abs(q.y)) - 0.32;
      if (uParticleShape > 3.5 && uParticleShape < 5.5) {
        vec2 h = abs(q);
        d = max(h.y, h.x * 0.866025 + h.y * 0.5) - 0.31;
        if (uParticleShape > 4.5) {
          float facet = floor((atan(q.y, q.x) + 3.14159) / 1.0472);
          sheen += 0.15 + 0.22 * sin(facet * 2.1 + vOrganicPulse);
        }
      }
      if (uParticleShape > 5.5 && uParticleShape < 8.5) {
        d = length(q) - 0.33;
        vec2 disc = q / 0.33;
        float nz = sqrt(max(0.0, 1.0 - dot(disc, disc)));
        vec3 normal = normalize(vec3(disc, max(0.001, nz)));
        materialNormal = normal;
        vec3 light = normalize(vec3(-0.45, 0.55, 1.0));
        float diffuse = max(0.0, dot(normal, light));
        float specular = pow(max(0.0, dot(normal, normalize(light + vec3(0.0, 0.0, 1.0)))), mix(100.0, 6.0, uRoughness));
        float rim = pow(1.0 - nz, 2.0);
        sphereLight = 0.22 + 0.78 * diffuse;
        sheen += specular * 0.85;
        if (uParticleShape > 6.5) {
          sphereTint = 0.84 + 0.16 * cos(rim * 8.0 + vec3(0.0, 2.094, 4.189));
          sphereLight = 0.5 + diffuse * 0.5 + rim * 0.2;
          sheen += specular * 0.6;
        }
      }
      if (uParticleShape > 8.5 && uParticleShape < 9.5) {
        d = livingIvyField(q, vOrganicPulse, uConnection);
        // Rounded relief normals come from the same field as the silhouette,
        // so the highlight follows the neck as it thins and separates.
        vec2 gradient = vec2(
          livingIvyField(q + vec2(0.003, 0.0), vOrganicPulse, uConnection) - d,
          livingIvyField(q + vec2(0.0, 0.003), vOrganicPulse, uConnection) - d) / 0.003;
        float relief = sqrt(max(0.02, 1.0 - pow(clamp(1.0 + d / 0.085, 0.0, 1.0), 2.0)));
        vec3 normal = normalize(vec3(gradient * 0.65, relief));
        materialNormal = normal;
        vec3 light = normalize(vec3(-0.45, 0.55, 1.0));
        float specular = pow(max(0.0, dot(normal, normalize(light + vec3(0.0, 0.0, 1.0)))), mix(90.0, 5.0, uRoughness));
        sphereLight = 0.3 + 0.7 * max(0.0, dot(normal, light));
        sheen += specular * 0.9;
        sphereTint = 0.92 + 0.08 * cos((1.0 - relief) * 6.0 + vec3(0.0, 2.094, 4.189));
      }
      if (uTail > 0.5) d = organicUnion(d, capsule(q, vec2(-0.45, 0.0), vec2(0.0, 0.0), 0.025), 0.055);
      silhouette = (1.0 - smoothstep(-0.025, 0.045, d)) * squareEdge;
      // Use each source sample's coverage for its entire organic silhouette.
      // This keeps the tip of a stem from being cut into a photographic square.
      coverage = texture2D(uPhoto, vPhotoUV).a * texture2D(uPhotoMask, vPhotoUV).r;
      if (uParticleShape > 7.5 && uParticleShape < 8.5) {
        float bubbleRim = pow(clamp(length(q) / 0.33, 0.0, 1.0), 5.0);
        silhouette *= 0.12 + bubbleRim * 0.8;
      }
      sheen += exp(-abs(d + 0.035) * 38.0) * 0.12;
    }
    if (uParticleShape > 9.5 && vPart > 1.5) silhouette = exp(-dot(vPatch, vPatch) * 22.0) * squareEdge;
    float soft = silhouette * coverage;
    if (soft < 0.005) discard;
    vec3 col = mix(photo.rgb, pow(max(vColor, vec3(0.0)), vec3(2.2)), uParticleShape > 0.5 && vPart > 1.5 ? 0.7 : uBlend * 0.35);
    col = col * sphereLight * sphereTint * (1.0 + sheen) + vec3(sheen * 0.12);
    if (vPart > 1.5) {
      // Analytic studio environment: broad softboxes reflected by the relief normal.
      vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), materialNormal);
      float softbox = pow(max(0.0, dot(reflected, normalize(vec3(-0.6, 0.7, 1.0)))), mix(100.0, 3.0, uRoughness));
      float strip = pow(max(0.0, dot(reflected, normalize(vec3(0.8, -0.2, 0.6)))), mix(70.0, 2.0, uRoughness));
      vec3 studio = vec3(0.9, 0.95, 1.0) * softbox + vec3(1.0, 0.8, 0.6) * strip * 0.45;
      col = col * (1.0 - uMetalness * 0.25) + studio * uReflection * mix(vec3(1.0), col, uMetalness);
    }
    if (uDichroic > 0.5 && vPart > 1.5) {
      vec3 film = 0.65 + 0.35 * cos(vPatch.x * 5.0 + vPatch.y * 3.0 + vOrganicPulse + vHuePhase + vec3(0.0, 2.094, 4.189));
      col = mix(col, col * film * 1.7, 0.65);
    }`)
    .replace('soft * uAlpha * vBlend / (1.0 + vCoc * 2.0)', 'soft * uAlpha');
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPhoto: { value: texture }, uPhotoMask: { value: mask }, uWorldPixel: { value: data.worldSize },
      uFootprint: { value: data.footprint }, uPhotoBasis: { value: new Float32Array(data.basis) } },
    vertexShader: declarations + vertex,
    fragmentShader: `
      uniform float uTail;
      uniform float uDichroic;
      uniform float uRoughness;
      uniform float uReflection;
      uniform float uMetalness;
      uniform float uParticleShape;
      uniform float uConnection;
      varying float vOrganicPulse;
      float capsule(vec2 p, vec2 a, vec2 b, float r) {
        vec2 ab = b - a;
        return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0)) - r;
      }
      float organicUnion(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
        return mix(b, a, h) - k * h * (1.0 - h);
      }
      float livingIvyField(vec2 p, float phase, float bond) {
        p.y += sin(p.x * 7.0 + phase) * 0.024;
        float release = smoothstep(-0.5, 0.85, phase) * (1.0 - bond * 0.85);
        float otherRelease = smoothstep(-0.5, 0.85, -phase) * (1.0 - bond * 0.85);
        float k = 0.025 + bond * 0.055;
        float body = capsule(p, vec2(-0.36, 0.0), vec2(0.36, 0.0), 0.043);
        float branchA = capsule(p, vec2(-0.18, 0.0), vec2(-0.09, 0.10), 0.035 * (1.0 - release * 0.8));
        float branchB = capsule(p, vec2(0.08, 0.0), vec2(0.17, -0.10), 0.035 * (1.0 - otherRelease * 0.8));
        body = organicUnion(body, branchA, k);
        body = organicUnion(body, branchB, k);
        float budA = length(p - vec2(-0.07 + release * 0.025, 0.14 + release * 0.19)) - 0.075;
        float budB = length(p - vec2(0.19 - otherRelease * 0.025, -0.14 - otherRelease * 0.19)) - 0.07;
        return organicUnion(organicUnion(body, budA, k), budB, k);
      }
    ` + 'varying vec2 vPatch;\nvarying vec2 vPhotoUV;\nuniform sampler2D uPhoto;\nuniform sampler2D uPhotoMask;\nuniform mat2 uPhotoBasis;\nuniform float uFootprint;\nuniform float uBlend;\n' + fragment,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, ready: () => ready, dispose() { disposed = true; geometry.dispose(); material.dispose(); texture.dispose(); mask?.dispose(); } };
}
