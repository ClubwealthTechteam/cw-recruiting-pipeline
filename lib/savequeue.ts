import 'server-only';
import { revalidateTag } from 'next/cache';
import { claimNextOp, finishOp, applyPatches, getKvs, dbConfigured } from '@/lib/db';
import { call, PIPELINE_TAG } from '@/lib/sheet';

/** Fast saves are on when the Database page says so and the CRM already reads from the database. */
export async function fastSavesOn(): Promise<boolean> {
  if (!dbConfigured()) return false;
  try {
    const kv = await getKvs(['fastSaves', 'readFromDb', 'lastFullCopy']);
    return kv.fastSaves === true && kv.readFromDb === true && !!kv.lastFullCopy;
  } catch {
    return false;
  }
}

/**
 * Hands waiting saves to the Apps Script one at a time, oldest first (database stage 2). The Apps Script does the real
 * work on the sheet and sends the rows it wrote back to the database. If it refuses a save, the change shown in the
 * CRM is put back and the person sees why on their next page. "Busy" means nothing was saved: try again later.
 */
export async function drainOps(budgetMs = 45000) {
  const end = Date.now() + budgetMs;
  while (Date.now() < end) {
    const op = await claimNextOp();
    if (!op) return;
    try {
      await call({ ...op.body, by: op.by_user });
      await finishOp(op.id, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      if (/busy finishing another update/i.test(msg)) {
        await finishOp(op.id, false, 'retry'); // marks failed; put back to pending below
        await requeue(op.id);
        return; // the 5-minute update nudges the queue again
      }
      const unsure = /did not respond|error page|took too long/i.test(msg);
      if (!unsure) await applyPatches(op.revert); // the sheet refused: show what is really there again
      await finishOp(op.id, false, unsure ? msg + ' (it may still have been saved: check before redoing it)' : msg);
    }
    revalidateTag(PIPELINE_TAG);
  }
}

async function requeue(id: number) {
  const { neon } = await import('@neondatabase/serverless');
  await neon(process.env.DATABASE_URL!).query("update ops set status = 'pending', started_at = null, finished_at = null, error = null where id = $1", [id]);
}
