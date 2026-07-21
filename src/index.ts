import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';
import { createHttpServer } from './http/server.js';
import { startVoiceTracker } from './awareness/voiceTracker.js';
import { startHeartbeat } from './awareness/heartbeat.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required - see .env.example');
}
const apiSecret = process.env.BOT_API_SECRET;
if (!apiSecret) {
  throw new Error('BOT_API_SECRET is required - see .env.example');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    // Roster capture reads message *authors* (text-active presence) and
    // reactors (attendance-post presence). Neither needs the privileged
    // MessageContent intent - we key on presence, not message text.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const supabase = getSupabaseClient();
  subscribeToCommands(supabase, readyClient);
  console.log('Subscribed to bot_commands');

  // Awareness layer (passive): the bot now watches the room and records it.
  const trackedVoice = (process.env.FRACTAL_VOICE_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  startVoiceTracker(client, supabase, trackedVoice);
  startHeartbeat(client, supabase);
  console.log(
    `Awareness active: voice tracker (${trackedVoice.length ? trackedVoice.length + ' tracked channel(s)' : 'all channels'}) + heartbeat`,
  );

  const port = Number(process.env.HTTP_PORT ?? 8080);
  createHttpServer(supabase, apiSecret).listen(port, () => {
    console.log(`HTTP fallback server listening on port ${port}`);
  });
});

await client.login(token);
