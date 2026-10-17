/** Multipliers for controlled ecology experiments. All 1s reproduce the legacy balance. */
export interface EcologyConfig {
  /** 0 preserves the audited behavior; 1 enables experimental decisions; 2 corrects shared-food competition. */
  behaviorModel?: 0 | 1 | 2;
  initialPlantCount: number;
  plantGrowth: number;
  plantCapacity: number;
  plantReseedingPlantOnly: boolean;
  feedingEfficiency: number;
  metabolicCost: number;
  movementCost: number;
  predatorDamage: number;
  predatorPursuitCost: number;
  herbivoreFertilityThreshold: number;
  scavengerCarrionRange: number;
  mateDetectionRange: number;
  disasterFrequency: number;
  disasterSeverity: number;
}

export const LEGACY_ECOLOGY_CONFIG: Readonly<EcologyConfig> = Object.freeze({
  behaviorModel: 0,
  initialPlantCount: 220,
  plantGrowth: 1,
  plantCapacity: 1,
  plantReseedingPlantOnly: false,
  feedingEfficiency: 1,
  metabolicCost: 1,
  movementCost: 1,
  predatorDamage: 1,
  predatorPursuitCost: 1,
  herbivoreFertilityThreshold: 1,
  scavengerCarrionRange: 1,
  mateDetectionRange: 1,
  disasterFrequency: 1,
  disasterSeverity: 1,
});

export function resolveEcologyConfig(input?: Partial<EcologyConfig>): EcologyConfig {
  const result = { ...LEGACY_ECOLOGY_CONFIG, ...input };
  for (const key of Object.keys(LEGACY_ECOLOGY_CONFIG) as (keyof EcologyConfig)[]) {
    const value = result[key];
    if (key === 'behaviorModel') {
      if (value !== 0 && value !== 1 && value !== 2) throw new Error(`Invalid ecology config: ${key}`);
      continue;
    }
    if (key === 'plantReseedingPlantOnly') {
      if (typeof value !== 'boolean') throw new Error(`Invalid ecology config: ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > (key === 'initialPlantCount' ? 500 : 3)) {
      throw new Error(`Invalid ecology config: ${key}`);
    }
  }
  if (!Number.isInteger(result.initialPlantCount)) throw new Error('initialPlantCount must be an integer');
  return result;
}

export function isValidEcologyConfig(value: unknown): value is EcologyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(LEGACY_ECOLOGY_CONFIG).some(key => key !== 'behaviorModel' && !(key in record))) return false;
  try {
    resolveEcologyConfig(value as EcologyConfig);
    return true;
  } catch {
    return false;
  }
}
