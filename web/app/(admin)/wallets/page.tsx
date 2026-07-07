import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { getWalletRegistry } from '../../../lib/getWalletRegistry.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

export default async function WalletsPage({ searchParams }: { searchParams: { q?: string } }) {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = session.discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  const supabase = getSupabaseClient();
  const wallets = await getWalletRegistry(supabase, searchParams.q);

  return (
    <main>
      <h1>Wallet Registry</h1>
      <form>
        <input type="text" name="q" defaultValue={searchParams.q ?? ''} placeholder="Search by wallet address" />
        <button type="submit">Search</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Discord ID</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.discordId}>
              <td>{w.discordId}</td>
              <td>{w.walletAddress}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
