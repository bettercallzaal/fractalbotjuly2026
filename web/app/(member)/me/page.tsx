import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { getLeaderboard } from '../../../lib/getLeaderboard.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordId = session.discordId;
  const walletAddress = session.walletAddress;

  const supabase = getSupabaseClient();
  const leaderboard = await getLeaderboard(supabase);
  const me = leaderboard.find(
    (entry) => (discordId && entry.discordId === discordId) || (walletAddress && entry.walletAddress === walletAddress),
  );

  return (
    <main>
      <h1>My Profile</h1>
      <p>Discord: {discordId ?? 'not linked'}</p>
      <p>Wallet: {walletAddress ?? 'not linked'}</p>
      <p>Respect: {me?.weight ?? 0}</p>
    </main>
  );
}
