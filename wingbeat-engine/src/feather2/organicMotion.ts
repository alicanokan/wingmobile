/** One continuous rest frame and displacement field for both render passes.
 * Colour IDs never become depth offsets. The central shaft carries the vane. */
export const ORGANIC_MOTION = /* glsl */ `
    float part = aPart;
    float core = aSurf.x;
    float loose = aSurf.y;
    float flow = aSurf.z;
    float hw = max(0.05, uHalfW);
    float s = clamp((position.y + 1.0) * 0.5, 0.0, 1.0);
    float rootWeight = smoothstep(0.015, 0.22, s);
    float shaftLocalX = position.x - aShaftX;
    float across = abs(shaftLocalX);
    float spine = exp(-pow(across / (hw * 0.055 + 0.006), 2.0));
    float attachment = 1.0 - exp(-pow(across / (hw * 0.22 + 0.012), 2.0));
    float rim = smoothstep(0.25, 1.0, across / hw);
    float down = (1.0 - smoothstep(0.18, 0.48, s)) * attachment;
    float cant = s * s * (0.55 + 0.45 * s);
    float drive = uStemTest > 0.5 ? uStemLevels[0] : min(2.0, uDrvFlex);
    float waveDrive = min(2.0, uDrvWave);
    float flutterDrive = min(2.0, uDrvFringe);
    float phase = uTime * 1.55 - s * 1.9;
    float bend = (0.006 + drive * 0.07) * sin(phase)
               + min(1.0, uDrvFlexHit) * 0.025 * sin(phase * 1.7);
    // The whole vane inherits the shaft's displacement at this height.
    vec3 P = vec3(position.xy, 0.0);
    P.x += bend * cant;
    P.y -= abs(bend) * cant * 0.15;
    P.z = hw * 0.10 * sin(s * 3.14159) - shaftLocalX * shaftLocalX / hw * 0.13;
    P.z += spine * hw * 0.025 * rootWeight;
    // Both shaft sections and the vane inherit one continuous curve. Rachis
    // Wave controls the whole shaft, never a separate calamus phase.
    float shaftGust = exp(-pow((position.y - uPointer.y) / 0.65, 2.0)
                         - pow((uPointer.x - aShaftX) / 0.65, 2.0)) * min(2.0, uWind);
    P.xy += uWindDirection * shaftGust * cant * 0.085;
    vec4 shaftLife = uPartLife[1];
    if (shaftLife.x > 5.5 && shaftLife.x < 6.5) {
      float shaftTime = uTime * shaftLife.z + shaftLife.w;
      P.x += sin(shaftTime * 1.7 - s * 3.0) * cant * 0.09 * shaftLife.y;
      P.z += sin(shaftTime - s * 5.0) * cant * 0.025 * shaftLife.y;
    }
    vec3 shaftPose = P;
    shaftPose.z *= clamp(uVolume, 0.0, 2.5) * 0.4 + 0.6;
    // A slow travelling wave leaves the shaft and arrives later at each edge.
    // Continuous spatial phase avoids independently translating colour bands.
    float outward = across / hw;
    float ripplePhase = uTime * 3.2 - outward * 7.0 - s * 4.5;
    float ripple = sin(ripplePhase) * (0.002 + drive * 0.015 + waveDrive * 0.012);
    float ripple2 = sin(uTime * 5.1 - outward * 10.5 - s * 8.0) * flutterDrive * 0.005;
    float vaneYield = attachment * rootWeight;
    P.z += (ripple + ripple2) * vaneYield;
    P.x += sign(shaftLocalX) * ripple * vaneYield * 0.25;
    P.y += ripple * vaneYield * 0.3;
    // Coherent low-frequency curl in down, tethered at its barb roots.
    float curl = sin(uTime * 3.7 - s * 13.0 - outward * 4.0);
    P.xy += vec2(sign(shaftLocalX), 0.35) * curl * down * rootWeight
          * (0.002 + flutterDrive * 0.009);
    // Local wind bends the shaft first, then sends a delayed ripple sideways.
    float gust = exp(-dot(position.xy - uPointer, position.xy - uPointer) / 0.3) * min(2.0, uWind);
    P.xy += uWindDirection * gust * vaneYield * (0.022 + down * 0.025);
    P.z += sin(uTime * 4.5 - outward * 8.0 - s * 3.0) * gust * vaneYield * 0.026;
    int groupIndex = int(clamp(floor(aCluster + 0.5), 0.0, 5.0));
    int patternIndex = int(clamp(floor(aPattern + 0.5), 0.0, 11.0));
    int partIndex = int(clamp(floor(part + 0.5), 0.0, 4.0));
    float groupSize = uGroupSize[groupIndex];
    float patternSize = aPattern >= 0.0 ? uPatternSize[patternIndex] : 1.0;
    float partSize = uPartSize[partIndex];
    float responseAccent = clamp(uGroupMovement[groupIndex] * uPartMovement[partIndex]
      * (aPattern >= 0.0 ? uPatternMovement[patternIndex] : 1.0), 0.0, 8.0);
    vec3 restBody = vec3(position.xy, hw * 0.10 * sin(s * 3.14159)
      - shaftLocalX * shaftLocalX / hw * 0.13 + spine * hw * 0.025 * rootWeight);
    P = restBody + (P - restBody) * min(4.0, responseAccent);
    float protectedCore = max(spine, 1.0 - smoothstep(0.02, 0.16, s));
    float mobility = 1.0 - uAnchor * protectedCore;
    vec3 routedAxis = clamp(uGroupAxis[groupIndex] + uPartAxis[partIndex]
      + (aPattern >= 0.0 ? uPatternAxis[patternIndex] : vec3(0.0)), vec3(-3.0), vec3(3.0));
    P += routedAxis * mobility * vec3(0.24, 0.18, 0.40);
    float colourPlane = (float(groupIndex) - 2.5) / 2.5;
    float patternPlane = aPattern >= 0.0 ? 0.4 + fract(aPattern * 0.618) * 0.6 : 0.0;
    float partPlane = part == 0.0 ? -0.4 : part == 1.0 ? 0.5 : part == 3.0 ? -0.7 : 0.25;
    float separation = (uGroupDepth[groupIndex] - 1.0) * colourPlane
      + (uPartDepth[partIndex] - 1.0) * partPlane
      + (aPattern >= 0.0 ? (uPatternDepth[patternIndex] - 1.0) * patternPlane : 0.0);
    separation += uDrvDepth * uAmpDepth * (colourPlane * 0.3 + partPlane * 0.5 + patternPlane * 0.3);
    P.z += separation * mobility * 0.32;
    // Markings swell from their own centres and retain their pixels in flight.
    if (aPatA.w > 0.5) {
      float markPulse = min(2.0, uDrvEye) * aPatC.x * 0.12;
      P.xy += (position.xy - aPatA.xy) * markPulse * mobility;
    }
    float seed = hash(position.xy * 71.0);
    float clock = uTime * (0.42 + seed * 0.12);
    vec3 field = vec3(sin(position.y * 4.0 + clock) * cos(position.x * 3.0 - clock),
      cos(position.x * 3.0 + clock) * sin(position.y * 2.0 - clock),
      sin(position.x * 4.0 + position.y * 3.0 - clock));
    if (uFlowMode > 0.5 && uFlowMode < 1.5) {
      field = vec3(0.45 + sin(clock + position.y * 4.0) * 0.25,
        0.5 + seed * 0.7, cos(clock + position.x * 3.0) * 0.4);
    } else if (uFlowMode > 1.5 && uFlowMode < 2.5) {
      float angle = clock + s * 6.2831 + seed * 0.3;
      field = vec3(cos(angle) * (0.5 + s), sin(angle) * (0.5 + s), sin(angle * 0.7) * 0.6);
    } else if (uFlowMode > 2.5) {
      field = normalize(vec3(position.x * 2.0 + (seed - 0.5) * 0.5,
        s - 0.35, sin(seed * 19.0) * 0.6) + vec3(0.0001)) * (0.5 + seed);
    }
    float release = uScatter + max(0.0, responseAccent - 1.0) * 0.12
      + uShed * (0.08 + loose * 0.18);
    P += field * release * mobility * 0.65;
    // Fine fibres move inside the mask, with stable spatial phase and no frame noise.
    P.xy += aBarb * sin(clock * 3.0 + s * 36.0 + seed * 2.0)
      * min(3.0, uDrvShimmer + uDrvFringe) * mobility * 0.008 * responseAccent;
    // Stable micro-depth retains the source detail while giving fibres a
    // shallow volume; no frame noise, and the locked shaft remains untouched.
    P.z += (seed - 0.5) * uThickness * hw * 0.16 * attachment * rootWeight;
    P.z *= clamp(uVolume, 0.0, 2.5) * 0.4 + 0.6;
    float glow = (waveDrive * 0.035 + flutterDrive * 0.025 + gust * 0.025) * attachment;
    vBlend = clamp(uBlend * (0.25 + 0.75 * attachment) * rootWeight, 0.0, 1.0);
    // The rachis and calamus retain photographic coverage at every blend level.
    vBlend *= part < 1.5 ? 0.0 : 1.0 - spine * 0.98;
    vBlend = mix(1.0, vBlend, uPhotoAvailable);
`;
