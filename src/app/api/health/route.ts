import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness only. No authentication, and deliberately no data. */
export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'medinext-marketing-os' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
