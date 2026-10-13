/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClimateState, EnvironmentalDisaster } from '../../types/simulation.js';

export const TICKS_PER_DAY = 2400; // 2 minutes per full day/night cycle at 50ms tick
export const TICKS_PER_YEAR = TICKS_PER_DAY * 4; // 4 days per year (spring, summer, autumn, winter)

export function createInitialClimate(): ClimateState {
  return {
    dayCycle: 0.15, // morning start
    temperature: 18.5,
    rainfall: 0.35,
    season: 'spring',
    solarRadiation: 0.8,
    climateTrend: 0,
    globalTempAnomaly: 0,
    globalRainAnomaly: 0,
    isDrought: false,
    droughtSeverity: 0,
    activeDisasters: [],
    disasterHistoryCount: 0,
  };
}

export function updateClimate(current: ClimateState, tick: number): ClimateState {
  const dayCycle = (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const yearCycle = (tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;

  // Day sun curve (0 to 1, max at midday 0.25)
  // Sinusoidal curve where day is [0, 0.5], night is [0.5, 1.0]
  const sunAngle = dayCycle * Math.PI * 2;
  // Day peaks at 0.25 (sin(0.25*2*PI) = sin(PI/2) = 1)
  const sunRaw = Math.sin(sunAngle);
  let solarRadiation = Math.max(0, sunRaw);

  // Seasons
  let season: 'spring' | 'summer' | 'autumn' | 'winter';
  let seasonalTempOffset = 0;
  let seasonalRainOffset = 0;

  if (yearCycle < 0.25) {
    season = 'spring';
    seasonalTempOffset = 0;
    seasonalRainOffset = 0.20; // snowmelt & spring rains
  } else if (yearCycle < 0.5) {
    season = 'summer';
    seasonalTempOffset = 7.0;  // warm summer heat
    seasonalRainOffset = -0.15;// drier season
  } else if (yearCycle < 0.75) {
    season = 'autumn';
    seasonalTempOffset = 1.0;  // crisp autumn
    seasonalRainOffset = 0.05;
  } else {
    season = 'winter';
    seasonalTempOffset = -8.5; // freezing winter
    seasonalRainOffset = -0.18;// frozen precipitation
  }

  // Multi-cycle slow macro climate trend (e.g. multi-eon oscillation without chaos)
  const climateTrend = Math.sin(tick * 0.00012) * 0.7 + Math.cos(tick * 0.00031) * 0.3;
  const macroTempOffset = climateTrend * 3.5;
  const macroRainOffset = Math.sin(tick * 0.00018 + 0.9) * 0.22;

  // Diurnal temperature swing (cooler at night, warmer at noon)
  const diurnalTempOffset = sunRaw * 6.5;

  // Active disaster global modulations
  let disasterTempMod = 0;
  let disasterRainMod = 0;
  let isDrought = !!current.isDrought;
  let droughtSeverity = current.droughtSeverity || 0;

  const activeDisasters = current.activeDisasters || [];
  for (let i = 0; i < activeDisasters.length; i++) {
    const d = activeDisasters[i];
    if (!d.active) continue;

    if (d.type === 'drought') {
      isDrought = true;
      droughtSeverity = Math.max(droughtSeverity, d.severity);
      disasterRainMod -= d.severity * 0.65;
      disasterTempMod += d.severity * 2.5;
    } else if (d.type === 'volcanic_eruption') {
      // Ash cloud blocks solar radiation globally/regionally
      solarRadiation *= Math.max(0.25, 1.0 - d.severity * 0.55);
      disasterTempMod -= d.severity * 4.5; // Volcanic winter
    } else if (d.type === 'cold_snap') {
      disasterTempMod -= d.severity * 5.0;
    }
  }

  const globalTempAnomaly = Math.round((seasonalTempOffset + macroTempOffset + disasterTempMod) * 10) / 10;
  const globalRainAnomaly = Math.round((seasonalRainOffset + macroRainOffset + disasterRainMod) * 100) / 100;

  const baselineTemp = 17.0;
  const temperature = Math.round((baselineTemp + globalTempAnomaly + diurnalTempOffset) * 10) / 10;

  // Rainfall modulation
  const rainWave = 0.32 + 0.20 * Math.sin(tick * 0.003) + globalRainAnomaly;
  const rainfall = isDrought
    ? Math.max(0.01, Math.min(0.12, rainWave * (1.0 - droughtSeverity * 0.85)))
    : Math.max(0.04, Math.min(0.96, rainWave));

  return {
    dayCycle,
    temperature,
    rainfall: Math.round(rainfall * 100) / 100,
    season,
    solarRadiation: Math.round(solarRadiation * 100) / 100,
    climateTrend: Math.round(climateTrend * 100) / 100,
    globalTempAnomaly,
    globalRainAnomaly,
    isDrought,
    droughtSeverity: Math.round(droughtSeverity * 100) / 100,
    activeDisasters,
    disasterHistoryCount: current.disasterHistoryCount || 0,
  };
}

export {
  getEffectiveLocalTemperature,
  getEffectiveLocalMoisture,
  evaluateDisasterTriggers,
  updateEnvironmentalDisasters,
  DEFAULT_DISASTER_COOLDOWNS,
  type DisasterCooldowns,
} from './environment.js';
