/* Isolated private diagnostic. Does not upload or save the .dem. */
import { DemoReader, EntityMode } from 'cs2parser/browser';

const counts = Object.create(null);
let lastProgress = 0;
let lastMessage = 0;
const send = (type, payload={}) => postMessage({ type, ...payload });
const safeError = error => String(error?.stack ?? error?.message ?? error ?? 'Unknown parser failure').slice(0, 2000);

self.onmessage = async ({ data }) => {
  if (data?.type !== 'parse' || !(data.file instanceof Blob)) return;
  const file = data.file;
  const reader = new DemoReader();
  const names = [
    'round_start', 'round_end', 'round_freeze_end',
    'round_officially_ended', 'round_prestart',
    'player_death', 'player_hurt', 'player_blind',
    'bomb_planted', 'bomb_defused', 'bomb_exploded',
    'flashbang_detonate', 'smokegrenade_detonate'
  ];
  for (const name of names) {
    counts[name] = 0;
    reader.gameEvents.on(name, () => { counts[name]++; });
  }
  reader.on('progress', bytesParsed => {
    if (typeof bytesParsed !== 'number' || !Number.isFinite(bytesParsed)) return;
    const p = Math.max(0, Math.min(100, 100 * bytesParsed / Math.max(1, file.size)));
    if (p - lastProgress >= 1 || Date.now() - lastMessage > 1200 || p >= 100) {
      lastProgress = p; lastMessage = Date.now();
      send('progress', { percent: p, bytesParsed });
    }
  });
  try {
    send('phase', { label: 'Parsing local demo with cs2parser/browser…' });
    const result = await reader.parseDemo(file, { entities: EntityMode.ALL });
    const controllers = Array.from(reader.playerControllers ?? []);
    const playersWithPosition = controllers.filter(p => p?.position != null).length;
    send('result', {
      status: String(result?.status ?? 'unknown'),
      counts,
      playerCount: controllers.length,
      playersWithPosition,
      bytes: file.size,
      roundEvents: (counts.round_start||0) + (counts.round_end||0) + (counts.round_freeze_end||0),
      success: controllers.length > 0 && ((counts.round_end||0) > 0 || (counts.round_start||0) > 0)
    });
  } catch (error) {
    send('error', { error: safeError(error), counts, bytes: file.size });
  }
};
