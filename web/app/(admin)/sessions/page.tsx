import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { RandomizeButton } from './RandomizeButton.js';

export default async function SessionsPage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = session.discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  return (
    <main>
      <h1>Fractal Session Control</h1>
      <RandomizeButton />
    </main>
  );
}
