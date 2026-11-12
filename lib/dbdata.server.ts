import 'server-only';
import { readTabs, getKvs } from '@/lib/db';
import { buildData, DATA_TABS } from './dbdata';
import type { PipelineData } from '@/lib/sheet';

/** The CRM's page data from the Neon copy (see buildData). */
export async function buildFromDb(withHistory: boolean): Promise<PipelineData> {
  const [t, kv] = await Promise.all([readTabs(DATA_TABS), getKvs(['team', 'jobAds', 'zoomConfigured'])]);
  return buildData(t, kv, withHistory);
}
