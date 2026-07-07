import type { SupabaseClient } from '@supabase/supabase-js';

interface CommandLogEntry {
  id: string;
  action: string;
  status: string;
  requestedBy: string;
  createdAt: string;
}

export async function getRecentCommands(supabase: SupabaseClient, limit = 20): Promise<CommandLogEntry[]> {
  const { data } = await supabase
    .from('bot_commands')
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row: any) => ({
    id: row.id,
    action: row.action,
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  }));
}
