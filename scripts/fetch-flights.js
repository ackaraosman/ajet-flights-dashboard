#!/usr/bin/env node
/**
 * AJET Flights Dashboard — fetch script (v2)
 *
 * One API call per day at 22:00 UTC. Fetches only the total flight count
 * from pagination.total (limit=1 to minimise data transfer). Appends the
 * count to the daily time series in data/data.json.
 *
 * Uses only Node 20 built-ins. No external dependencies.
 *
 * Environment variables:
 *   AVIATIONSTACK_KEY  (required)  — API access key
 *   DATA_PATH          (optional)  — output path; default "data/data.json"
 *
 * Exit codes:
 *   0 — success
 *   1 — error (error stub written so the site keeps rendering)
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

const AIRLINE_IATA = 'VF';
const API_BASE = 'https://api.aviationstack.com/v1/flights';
const SCHEMA_VERSION = 2;

const DATA_PATH = process.env.DATA_PATH || 'data/data.json';
const API_KEY = process.env.AVIATIONSTACK_KEY;

function nowIso() {
  return new Date().toISOString();
}

function todayUtc() {
  return nowIso().slice(0, 10);
}

function emptyStore() {
  return {
    meta: {
      schema_version: SCHEMA_VERSION,
      airline_iata: AIRLINE_IATA,
      last_run_utc: null,
      last_run_status: 'ok',
      last_run_error: null,
    },
    daily: [],
  };
}

async function readExistingData(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      meta: { ...emptyStore().meta, ...(parsed.meta || {}) },
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyStore();
    console.warn(`[warn] Could not parse existing data.json (${err.message}); starting fresh.`);
    return emptyStore();
  }
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  const json = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, p);
}

async function main() {
  if (!API_KEY || !API_KEY.trim()) {
    const msg = 'AVIATIONSTACK_KEY environment variable is missing or empty.';
    console.error(`[error] ${msg}`);
    process.exit(1);
  }

  // Use limit=1 — we only need pagination.total, not the flight records.
  const apiUrl = url.format({
    protocol: 'https:',
    hostname: 'api.aviationstack.com',
    pathname: '/v1/flights',
    query: {
      access_key: API_KEY,
      airline_iata: AIRLINE_IATA,
      limit: '1',
    },
  });

  const safeUrlForLog = apiUrl.replace(API_KEY, '***');
  console.log(`[info] GET ${safeUrlForLog}`);

  const store = await readExistingData(DATA_PATH);
  const tsIso = nowIso();
  const dateUtc = tsIso.slice(0, 10);

  let res;
  try {
    res = await fetch(apiUrl, { method: 'GET' });
  } catch (err) {
    const msg = `Network error: ${err && err.message ? err.message : String(err)}`;
    console.error(`[error] ${msg}`);
    store.meta.last_run_utc = tsIso;
    store.meta.last_run_status = 'error';
    store.meta.last_run_error = msg;
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  if (!res.ok) {
    const msg = `HTTP ${res.status} from AviationStack.`;
    console.error(`[error] ${msg}`);
    store.meta.last_run_utc = tsIso;
    store.meta.last_run_status = 'error';
    store.meta.last_run_error = msg;
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    const msg = `Non-JSON response (status ${res.status}).`;
    console.error(`[error] ${msg}`);
    store.meta.last_run_utc = tsIso;
    store.meta.last_run_status = 'error';
    store.meta.last_run_error = msg;
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  if (body && body.error) {
    const msg = `API error: ${JSON.stringify(body.error)}`;
    console.error(`[error] ${msg}`);
    store.meta.last_run_utc = tsIso;
    store.meta.last_run_status = 'error';
    store.meta.last_run_error = msg;
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  const pagination = body.pagination || {};
  const flightCount = typeof pagination.total === 'number' ? pagination.total : 0;

  // Upsert today's row into the daily time series.
  const existing = store.daily.find((row) => row.date_utc === dateUtc);
  if (existing) {
    existing.flight_count = flightCount;
  } else {
    store.daily.push({ date_utc: dateUtc, flight_count: flightCount });
  }

  store.meta.last_run_utc = tsIso;
  store.meta.last_run_status = 'ok';
  store.meta.last_run_error = null;

  await atomicWriteJson(DATA_PATH, store);

  console.log(`[info] ${dateUtc}: ${flightCount} flights recorded.`);
}

main().catch(async (err) => {
  const tsIso = nowIso();
  const msg = `Unhandled exception: ${err && err.message ? err.message : String(err)}`;
  console.error(`[error] ${msg}`);
  try {
    const store = await readExistingData(DATA_PATH);
    store.meta.last_run_utc = tsIso;
    store.meta.last_run_status = 'error';
    store.meta.last_run_error = msg;
    await atomicWriteJson(DATA_PATH, store);
  } catch (writeErr) {
    console.error(`[error] Could not write error stub: ${writeErr.message}`);
  }
  process.exit(1);
});
