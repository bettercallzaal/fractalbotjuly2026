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

  let body;
  try {
    body = await req.json();
  } catch (error) {
    console.error('Failed to parse request body:', error);
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  try {
    const result = await dispatchCommand(
      supabase,
      params.action,
      body.params ?? {},
      session.discordId,
      process.env.BOT_API_URL!,
      process.env.BOT_API_SECRET!,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to dispatch command:', error);
    return NextResponse.json({ error: 'command failed' }, { status: 500 });
  }
}
