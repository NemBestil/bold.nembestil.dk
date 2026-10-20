const TABLE_HALF_LENGTH = 1.4;

/** SI units. X runs goal-to-goal; rods translate and rotate on Z. */
export const GAME_CONFIG = {
  physics: {
    timestep: 1 / 120,
    gravity: -9.81,
    maxFrameTime: 0.1,
    maxSteps: 12,
  },
  rendering: {
    targetFps: 60,
    // Visual snapshots follow the display; continuous control input stays at 30 Hz.
    tableStreamFps: 60,
    controllerFps: 30,
    maxPixelRatio: 1.7,
    shadowSize: 1024,
  },
  table: {
    halfLength: TABLE_HALF_LENGTH,
    halfWidth: 0.75,
    wallThickness: 0.09,
    wallHeight: 0.48,
    goalHalfWidth: 0.23,
    goalHeight: 0.22,
    goalLine: 1.48,
    servingHoleHalfWidth: 0.105,
    servingHoleHeight: 0.14,
    rodHeight: 0.235,
    floorHalfLength: 1.77,
    floorHalfWidth: 0.91,
    wallZ: 0.795,
    endWallX: 1.455,
    goalBackX: 1.74,
    goalDepth: 0.3,
    surfaceRise: 0.02,
    cornerRise: 0.022,
    sideSlopeStart: 0.6796875,
    // Broad, shallow corners return a resting ball toward defense in about 2 s.
    cornerRampLength: 0.48,
    outLength: 1.91,
    outWidth: 1.12,
    outFloor: -0.65,
  },
  ball: {
    radius: 0.033,
    mass: 0.028,
    restitution: 0.3,
    friction: 0.4,
    linearDamping: 0.23,
    angularDamping: 0.28,
    stuckSpeed: 0.075,
    // Base speed: 2.5 seconds across the 2.8 m pitch; new strikes may add incoming speed.
    maxSpeed: (2 * TABLE_HALF_LENGTH) / 2.5,
    // Actual rod motion adds a little arcade steering to the physical foot normal.
    rodDirectionInfluence: 0.35,
    // A sideways roll from a trapped ball is slightly faster than the gesture.
    pinReleaseSpeedGain: 1.2,
    pinReleaseMaxSpeed: 0.8,
    pinReleaseInwardRatio: 0.16,
  },
  figure: {
    bodyHalfWidth: 0.038,
    bodyHalfHeight: 0.073,
    bodyHalfDepth: 0.038,
    bodyY: -0.023,
    footHalfSize: 0.046,
    footEdgeBevel: 0.005,
    footExponent: 4,
    footY: -0.171,
    headRadius: 0.044,
    headY: 0.12,
    footFriction: 0.65,
    footRestitution: 0.25,
  },
  rods: {
    // Extra 3.5 cm inset: a full ball diameter plus 1.8 cm beside every outer foot.
    wallClearance: 0.084,
    maxAngularVelocity: 35,
    maxAngularAcceleration: 180,
    maxTranslationSpeed: 8,
    inputTimeout: 0.2,
    passiveGravity: 65,
    passiveDamping: 5.8,
    // Whole-rod inertia about its fixed axis; passive figures can yield to a ball.
    passiveAngularInertia: 0.00025,
    inertiaGrace: 0.1,
    settleAngle: 0.006,
    settleSpeed: 0.06,
  },
  serving: { speed: 0.8, randomnessDegrees: 5, duration: 0.7 },
  bump: { cooldown: 3, verticalFraction: 0.32 },
  match: { countdownDuration: 3, goalDuration: 1.6, outDuration: 1.4 },
  replay: {
    maxDuration: 8,
    slowMotionSeconds: 1,
    slowMotionSpeed: 1 / 3,
    touchLeadIn: 0.3,
    touchFollowThrough: 0.9,
    recentHistory: 2,
  },
} as const;

export const ROD_LAYOUT = ([
  { team: "red", id: 0, x: -1.23, count: 1, spacing: 0, travel: 0.25 },
  { team: "red", id: 1, x: -1.0, count: 2, spacing: 0.63, travel: 0.34 },
  { team: "blue", id: 3, x: -0.66, count: 3, spacing: 0.43, travel: 0.225 },
  { team: "red", id: 2, x: -0.3, count: 5, spacing: 0.27, travel: 0.115 },
  { team: "blue", id: 2, x: 0.3, count: 5, spacing: 0.27, travel: 0.115 },
  { team: "red", id: 3, x: 0.66, count: 3, spacing: 0.43, travel: 0.225 },
  { team: "blue", id: 1, x: 1.0, count: 2, spacing: 0.63, travel: 0.34 },
  { team: "blue", id: 0, x: 1.23, count: 1, spacing: 0, travel: 0.25 },
] as const).map((layout) => ({
  ...layout,
  travel: Math.min(
    layout.travel,
    GAME_CONFIG.table.halfWidth -
      GAME_CONFIG.rods.wallClearance -
      Math.max(
        GAME_CONFIG.figure.footHalfSize,
        GAME_CONFIG.figure.headRadius,
        GAME_CONFIG.figure.bodyHalfDepth,
      ) -
      ((layout.count - 1) * layout.spacing) / 2,
  ),
}));
