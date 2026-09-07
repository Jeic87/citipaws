#!/usr/bin/env node
/**
 * Verifica si citypaws.store sigue bloqueado por robots.txt en origen
 * y notifica por webhook (Discord/Telegram) solo cuando el estado
 * pasa de BLOQUEADO a ABIERTO.
 *
 * Nota honesta: no existe forma fiable ni permitida de leer el
 * indice interno de Google (ni scrapear "site:") sin la API oficial
 * de Search Console. Este script verifica la senal real y accionable
 * en origen: robots.txt, sitemap.xml y que la home responde 200.
 * Para el estado exacto "Indexada" en GSC, revisa la UI manualmente
 * 24-48h despues de recibir la notificacion de este script.
 */

const fs = require('fs');
const path = require('path');

const SITE = 'https://citypaws.store';
const ROBOTS_URL = SITE + '/robots.txt';
const SITEMAP_URL = SITE + '/sitemap.xml';
const STATE_FILE = '.github/state/cache-status.json';

const WEBHOOK_URL = process.env.NOTIFICATION_WEBHOOK_URL;
const WEBHOOK_TYPE = (process.env.NOTIFICATION_WEBHOOK_TYPE || 'discord').toLowerCase();
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'CityPawsCacheCheck/1.0' } });
  return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : '' };
}

function isRobotsOpen(robotsTxt) {
  const lines = robotsTxt.split('\n').map(l => l.trim());
  let blockingAll = false;
  for (const line of lines) {
    if (/^disallow:\s*\/\s*$/i.test(line)) blockingAll = true;
    if (/^allow:\s*\/\s*$/i.test(line)) blockingAll = false;
  }
  return !blockingAll;
}

function loadPreviousState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { status: 'UNKNOWN' };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendNotification(message) {
  if (!WEBHOOK_URL) {
    console.log('NOTIFICATION_WEBHOOK_URL no configurado, omito notificacion.');
    return;
  }
  if (WEBHOOK_TYPE === 'telegram') {
    const url = WEBHOOK_URL.replace(/\/$/, '') + '/sendMessage';
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
    });
  } else {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  }
}

async function main() {
  const [robots, sitemap, home] = await Promise.all([
    fetchText(ROBOTS_URL),
    fetchText(SITEMAP_URL),
    fetchText(SITE),
  ]);

  const robotsOpen = robots.ok && isRobotsOpen(robots.body);
  const sitemapOk = sitemap.ok && sitemap.body.includes('<urlset');
  const homeOk = home.ok;

  const currentStatus = (robotsOpen && sitemapOk && homeOk) ? 'ABIERTO' : 'BLOQUEADO';
  const prev = loadPreviousState();

  console.log('robots.txt abierto: ' + robotsOpen + ' | sitemap ok: ' + sitemapOk + ' | home 200: ' + homeOk);
  console.log('Estado anterior: ' + prev.status + ' -> Estado actual: ' + currentStatus);

  if (prev.status !== 'ABIERTO' && currentStatus === 'ABIERTO') {
    await sendNotification(
      'Buenas noticias! citypaws.store: robots.txt, sitemap y home responden ' +
      'correctamente en origen. La senal tecnica de bloqueo ya no existe. ' +
      'Revisa Google Search Console en 24-48h para confirmar el estado de indexacion.'
    );
  }

  saveState({ status: currentStatus, checkedAt: new Date().toISOString() });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
