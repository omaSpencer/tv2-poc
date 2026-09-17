import { describe, expect, it } from 'vitest';
import { scenarioDefinitionSchema } from './schema';
import { SCENARIOS } from './registry';

describe('Phase 6 scenario registry', () => {
  it('contains five runtime-validated, unique scenarios and unique step ids', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05']);
    for (const scenario of SCENARIOS) {
      expect(() => scenarioDefinitionSchema.parse(scenario)).not.toThrow();
      expect(new Set(scenario.steps.map((step) => step.id)).size).toBe(scenario.steps.length);
    }
  });

  it('rejects arbitrary operations and duplicate step ids', () => {
    const base = structuredClone(SCENARIOS[0]) as Record<string, unknown>;
    const steps = base.steps as Array<Record<string, unknown>>;
    steps[0].operation = 'fetch.any-url';
    expect(scenarioDefinitionSchema.safeParse(base).success).toBe(false);

    const duplicate = structuredClone(SCENARIOS[0]) as Record<string, unknown>;
    const duplicateSteps = duplicate.steps as Array<Record<string, unknown>>;
    duplicateSteps[1].id = duplicateSteps[0].id;
    expect(scenarioDefinitionSchema.safeParse(duplicate).success).toBe(false);
  });
});
