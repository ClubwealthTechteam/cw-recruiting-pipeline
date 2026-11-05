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
