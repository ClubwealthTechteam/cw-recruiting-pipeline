import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** The build that is live right now. Open tabs compare it with the build they loaded. */
export function GET() {
  return NextResponse.json(
    { build: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
