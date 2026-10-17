import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './simulation/engine.js';
import { updateOrganismMetabolism } from './simulation/organism/organism.js';

describe('development-only physiological maturity', () => {
  it('requires genetic age plus acquired food and current condition', () => {
    const source = new SimulationEngine(691153, { behaviorModel: 1 }).organisms[0];
    const org = { ...structuredClone(source), age: source.maturityAge - 1, isMature: false,
      energy: 58, health: 100, hydration: 85 };
    let intake = 0;
    const gate = () => intake >= 8 && org.energy >= 30 && org.health >= 70;
    const step = () => updateOrganismMetabolism(org, 20, false, false, undefined, undefined, gate);
    step();
    expect(org.age).toBe(org.maturityAge);
    expect(org.isMature).toBe(false);
    intake = 8;
    org.energy = 29;
    step();
    expect(org.isMature).toBe(false);
    org.energy = 58;
    org.health = 69;
    step();
    expect(org.isMature).toBe(false);
    org.health = 100;
    step();
    expect(org.isMature).toBe(true);
  });

  it('leaves ordinary age maturity intact', () => {
    const source = new SimulationEngine(691153, { behaviorModel: 1 }).organisms[0];
    const org = { ...structuredClone(source), age: source.maturityAge - 1, isMature: false,
      energy: 20, health: 100, hydration: 85 };
    updateOrganismMetabolism(org, 20);
    expect(org.isMature).toBe(true);
  });
});
