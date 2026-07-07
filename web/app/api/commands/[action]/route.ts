import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../auth.js';
import { getSupabaseClient } from '../../../../lib/supabaseClient.js';
import { isSupremeAdmin } from '../../../../lib/isSupremeAdmin.js';
import { dispatchCommand } from '../../../../lib/dispatchCommand.js';

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const session = await auth();
  if (!session || !session.discordId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const discordRoleIds = session.discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const supabase = getSupabaseClient();

  const result = await dispatchCommand(
    supabase,
    params.action,
    body.params ?? {},
    session.discordId,
    process.env.BOT_API_URL!,
    process.env.BOT_API_SECRET!,
  );

  return NextResponse.json(result);
}
