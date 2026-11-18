import { api } from '@/lib/ipc';
import { uid } from '@/lib/postman';
import { useTabs } from '@/stores/tabs';
import { errText, toast } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

import { useRuns } from './runs';
import { toEngineScenario } from './scenario';

export async function startScenario(scenarioId: string): Promise<string | null> {
  const ws = useWorkspace.getState();
  const doc = ws.scenarios[scenarioId];
  if (!doc) {
    toast('error', 'Scenario not found');
    return null;
  }
  const { scenario, problems } = toEngineScenario(doc);
  if (problems.length) toast('error', problems.join('; '));
  try {
    const env = doc.environmentId ? ws.environments[doc.environmentId]?.name : undefined;
    const id = await api.loadStart(scenario, { scenarioId, environment: env, testType: doc.testType });
    useRuns.getState().setLive(id, true);
    useRuns.getState().refresh();
    useTabs.getState().open({ id: uid(), kind: 'loadRun', runId: id });
    return id;
  } catch (e) {
    toast('error', errText(e));
    return null;
  }
}
