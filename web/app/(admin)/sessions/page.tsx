import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { getRecentCommands } from '../../../lib/getRecentCommands.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';
import { RandomizeButton } from './RandomizeButton.js';

export default async function SessionsPage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = session.discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  const supabase = getSupabaseClient();
  const recentCommands = await getRecentCommands(supabase);

  return (
    <main>
      <h1>Fractal Session Control</h1>
      <RandomizeButton />

      <h2>Recent Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {recentCommands.map((cmd) => (
            <tr key={cmd.id}>
              <td>{cmd.action}</td>
              <td>{cmd.status}</td>
              <td>{cmd.requestedBy}</td>
              <td>{cmd.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
