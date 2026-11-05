'use client';
import { parseStageChoice } from '@/lib/pipeline';

/**
 * For quick moves (list row, board): asks for the start date when the choice is "Hired | Homexa" or
 * "Hired | Clubwealth". Returns the extra fields for setStage, or null when cancelled.
 */
export function hireFields(choice: string, name = 'this applicant'): Record<string, string> | null {
  const { stage, company } = parseStageChoice(choice);
  if (!company) return { stage };
  const d = prompt(`${name}: ${stage} for ${company === 'Club Wealth' ? 'Clubwealth' : company}.\nStart date for the Welcome & Onboarding email (YYYY-MM-DD):`)?.trim() || '';
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert('Please type the date as YYYY-MM-DD, for example 2026-11-12.'); return null; }
  return { stage, company, startDate: d };
}

/** For quick moves to Not Fit: asks why (1, 2 or 3). Returns the setStage fields, or null when cancelled. */
export function notFitFields(name = 'this applicant'): Record<string, string> | null {
  const a = prompt(`${name}: why Not Fit?\n1 = Bad internet (no email)\n2 = Did not meet device requirements (no email)\n3 = General not fit, Tara, Ron or Maggie decided (Rejected email waits in Needs Approval)\n\nType 1, 2 or 3:`)?.trim() || '';
  const key = { 1: 'internet', 2: 'device', 3: 'general' }[a as '1' | '2' | '3'];
  if (!key) return null;
  const detail = prompt('Add a detail (optional):')?.trim() || '';
  return { notFitType: key, reason: detail };
}
