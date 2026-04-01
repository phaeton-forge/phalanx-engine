export const vfxConfig = {
  enabled: true, // master toggle

  camera: {
    beta: Math.PI / 3,            // 60deg from top = 30deg tilt from vertical
    alpha: -Math.PI / 2,          // behind player
    radius: 25,                   // zoom distance
    lowerRadiusLimit: 15,
    upperRadiusLimit: 40,
    followLerp: 0.1,             // camera follow smoothness (0-1)
  },

  glow: {
    enabled: true,
    mainTextureFixedSize: 512,
    blurKernelSize: 32,
    intensity: 0.4,
  },

  pipeline: {
    bloomEnabled: true,
    bloomThreshold: 0.7,
    bloomWeight: 0.15,
    bloomKernel: 32,
    bloomScale: 0.4,
    fxaaEnabled: true,
    chromaticAberrationEnabled: true,
    chromaticAberrationAmount: 15,
    chromaticAberrationRadialIntensity: 0.3,
    grainEnabled: true,
    grainIntensity: 8,
    grainAnimated: true,
    contrast: 1.3,
    exposure: 1.1,
    vignetteEnabled: true,
    vignetteWeight: 2.5,
    vignetteFov: 0.5,
    vignetteColor: { r: 0, g: 0.02, b: 0.05 },
  },

  colors: {
    player: {
      diffuse: { r: 0, g: 0.9, b: 1 },
      emissive: { r: 0, g: 0.35, b: 0.4 },
    },
    enemy: {
      diffuse: { r: 1, g: 0.3, b: 0.15 },
      emissive: { r: 0.4, g: 0.08, b: 0.04 },
    },
    projectile: {
      diffuse: { r: 0, g: 0.9, b: 1 },
      emissive: { r: 0, g: 0.9, b: 1 },
    },
    wall: {
      emissive: { r: 0, g: 0.8, b: 0.9 },
    },
    arenaGrid: {
      mainColor: { r: 0.05, g: 0.08, b: 0.12 },
      lineColor: { r: 0, g: 0.4, b: 0.5 },
    },
  },

  deathEffect: {
    // Core flash
    coreParticleCount: 15,
    coreEmitRate: 200,
    coreDuration: 0.05,
    coreMinSize: 0.8,
    coreMaxSize: 1.5,
    coreMinLife: 0.1,
    coreMaxLife: 0.2,
    // Sparks
    sparkParticleCount: 80,
    sparkEmitRate: 600,
    sparkDuration: 0.08,
    sparkMinSize: 0.04,
    sparkMaxSize: 0.15,
    sparkMinEmitPower: 5,
    sparkMaxEmitPower: 12,
    sparkMinLife: 0.2,
    sparkMaxLife: 0.6,
    sparkGravityY: -6,
    // Shockwave ring
    ringParticleCount: 40,
    ringEmitRate: 400,
    ringDuration: 0.05,
    ringMinEmitPower: 8,
    ringMaxEmitPower: 15,
    ringMinLife: 0.15,
    ringMaxLife: 0.35,
  },

  hitEffect: {
    particleCount: 30,
    emitRate: 300,
    duration: 0.15,
    minSize: 0.05,
    maxSize: 0.2,
    minLife: 0.1,
    maxLife: 0.3,
    minEmitPower: 2,
    maxEmitPower: 6,
    gravityY: -2,
  },

  trail: {
    diameter: 0.15,
    length: 60,
    sections: 4,
    alpha: 0.6,
  },

  ambient: {
    particleCount: 100,
    emitRate: 15,
    minLife: 3,
    maxLife: 6,
    minSize: 0.02,
    maxSize: 0.06,
    color: { r: 0, g: 0.8, b: 1, a: 0.15 },
  },

  screenShake: {
    decayRate: 5,
    minThreshold: 0.01,  // stop shaking below this intensity
    hitIntensity: 0.3,   // on projectile hit
    killIntensity: 0.6,  // on enemy death
    yMultiplier: 0.5,    // vertical shake is less than horizontal
  },

  pool: {
    initialSize: 10,     // pre-allocate this many particle systems
    maxSize: 50,          // never exceed this many pooled systems
  },
};
