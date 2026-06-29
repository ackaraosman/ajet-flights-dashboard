#!/usr/bin/env node
/**
 * AJET Flights Dashboard — fetch script
 *
 * Calls the AviationStack real-time API (free plan) for airline IATA VF,
 * normalises the response, and writes the result to data/data.json.
 *
 * Uses only Node 20 built-ins. No external dependencies.
 *
 * Environment variables:
 *   AVIATIONSTACK_KEY  (required)  — API access key
 *   DATA_PATH          (optional)  — output path; default "data/data.json"
 *
 * Exit codes:
 *   0 — success (data written with meta.last_run_status = "ok")
 *   1 — error (data still written, but meta.last_run_status = "error")
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

const AIRLINE_IATA = 'VF';
const API_BASE = 'https://api.aviationstack.com/v1/flights';
const MAX_RECORDS_PER_REQUEST = 100;
const MAX_SNAPSHOTS = 60;
const MAX_RETRIES_429 = 1;
const RETRY_SLEEP_MS = 7000;
const SCHEMA_VERSION = 1;

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
      last_run_flight_count: 0,
      last_run_error: null,
      api_calls_today_utc: 0,
    },
    latest: null,
    snapshots: [],
    daily: [],
  };
}

async function readExistingData(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    // Defensive defaults — heal old files that may miss keys.
    return {
      meta: { ...emptyStore().meta, ...(parsed.meta || {}) },
      latest: parsed.latest ?? null,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyStore();
    console.warn(`[warn] Could not parse existing data.json (${err.message}); starting fresh.`);
    return emptyStore();
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(apiUrl) {
  let attempt = 0;
  let lastResponse = null;
  while (attempt <= MAX_RETRIES_429) {
    const res = await fetch(apiUrl, { method: 'GET' });
    if (res.status !== 429) return res;
    lastResponse = res;
    if (attempt === MAX_RETRIES_429) return res;
    console.warn(`[warn] HTTP 429 received; sleeping ${RETRY_SLEEP_MS}ms before retry ${attempt + 1}/${MAX_RETRIES_429}.`);
    await sleep(RETRY_SLEEP_MS);
    attempt += 1;
  }
  return lastResponse;
}

function normaliseFlight(raw) {
  // AviationStack may return a partial record; never throw on missing fields.
  const flightIata = (raw && raw.flight && raw.flight.iata) || null;
  const departureIata = (raw && raw.departure && raw.departure.iata) || null;
  const arrivalIata = (raw && raw.arrival && raw.arrival.iata) || null;
  const status = (raw && raw.flight_status) || 'unknown';
  return {
    flight: flightIata || 'UNKNOWN',
    origin: departureIata || 'UNKNOWN',
    destination: arrivalIata || 'UNKNOWN',
    status,
  };
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = keyFn(item) || 'UNKNOWN';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function buildLatest(flights, capturedAtIso) {
  const flightCount = flights.length;
  const byStatus = groupBy(flights, (f) => f.status);
  const byOriginMap = groupBy(flights, (f) => f.origin);
  const byOrigin = Object.entries(byOriginMap)
    .map(([iata, count]) => ({ iata, count }))
    .sort((a, b) => b.count - a.count);
  return {
    captured_at_utc: capturedAtIso,
    flight_count: flightCount,
    by_status: byStatus,
    by_origin: byOrigin,
    flights,
  };
}

function upsertDaily(store, dateUtc, latestBlock, flightNumbers) {
  const count = latestBlock.flight_count;
  const byOriginLatest = {};
  for (const o of latestBlock.by_origin) byOriginLatest[o.iata] = o.count;

  // Deduplicate flight numbers seen this snapshot
  const newFlightNumbers = [...new Set(flightNumbers)];

  const existing = store.daily.find((row) => row.date_utc === dateUtc);
  if (existing) {
    existing.snapshot_count += 1;
    existing.last_count = count;
    existing.max_count = Math.max(existing.max_count, count);
    existing.min_count = Math.min(existing.min_count, count);
    existing.by_origin_latest = byOriginLatest;
    // Merge unique flight numbers across snapshots
    const merged = new Set([...(existing.unique_flight_numbers || []), ...newFlightNumbers]);
    existing.unique_flight_numbers = [...merged].sort();
    existing.unique_flights = existing.unique_flight_numbers.length;
    return existing;
  }
  const sorted = newFlightNumbers.sort();
  const row = {
    date_utc: dateUtc,
    snapshot_count: 1,
    first_count: count,
    last_count: count,
    max_count: count,
    min_count: count,
    unique_flight_numbers: sorted,
    unique_flights: sorted.length,
    by_origin_latest: byOriginLatest,
  };
  store.daily.push(row);
  return row;
}

function updateMeta(store, capturedAtIso, dateUtc, flightCount, status, errorMsg) {
  const prev = store.meta || {};
  const prevDate = (prev.last_run_utc || '').slice(0, 10);
  const apiCallsToday = prevDate === dateUtc ? (prev.api_calls_today_utc || 0) + 1 : 1;
  store.meta = {
    schema_version: SCHEMA_VERSION,
    airline_iata: AIRLINE_IATA,
    last_run_utc: capturedAtIso,
    last_run_status: status,
    last_run_flight_count: flightCount,
    last_run_error: errorMsg,
    api_calls_today_utc: apiCallsToday,
  };
}

async function atomicWriteJson(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  const json = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, p);
}

async function writeErrorStub(p, errorMsg, capturedAtIso, dateUtc) {
  // Even when the API call fails, we commit a stub so the deployed site
  // keeps rendering the previous snapshot rather than going blank.
  const store = await readExistingData(p);
  updateMeta(store, capturedAtIso, dateUtc, store.latest ? store.latest.flight_count : 0, 'error', errorMsg);
  await atomicWriteJson(p, store);
}

async function main() {
  if (!API_KEY || !API_KEY.trim()) {
    const msg = 'AVIATIONSTACK_KEY environment variable is missing or empty. Set it to your AviationStack access key.';
    console.error(`[error] ${msg}`);
    const tsIso = nowIso();
    await writeErrorStub(DATA_PATH, msg, tsIso, tsIso.slice(0, 10)).catch((e) => {
      console.error(`[error] Could not write error stub: ${e.message}`);
    });
    process.exit(1);
  }

  const apiUrl = url.format({
    protocol: 'https:',
    hostname: 'api.aviationstack.com',
    pathname: '/v1/flights',
    query: {
      access_key: API_KEY,
      airline_iata: AIRLINE_IATA,
      limit: String(MAX_RECORDS_PER_REQUEST),
    },
  });

  // Log the URL path only (no key) so workflow logs are useful.
  const safeUrlForLog = apiUrl.replace(API_KEY, '***');
  console.log(`[info] GET ${safeUrlForLog}`);

  const store = await readExistingData(DATA_PATH);
  const tsIso = nowIso();
  const dateUtc = tsIso.slice(0, 10);

  let res;
  try {
    res = await fetchWithRetry(apiUrl);
  } catch (err) {
    const msg = `Network error: ${err && err.message ? err.message : String(err)}`;
    console.error(`[error] ${msg}`);
    updateMeta(store, tsIso, dateUtc, 0, 'error', msg);
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  if (res.status === 429) {
    const msg = `Rate limited (HTTP 429) after ${MAX_RETRIES_429} retry. AviationStack free plan is exhausted for now.`;
    console.error(`[error] ${msg}`);
    updateMeta(store, tsIso, dateUtc, 0, 'error', msg);
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    const msg = `Non-JSON response (status ${res.status}).`;
    console.error(`[error] ${msg}`);
    updateMeta(store, tsIso, dateUtc, 0, 'error', msg);
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  if (body && body.error) {
    const msg = `API error: ${JSON.stringify(body.error)}`;
    console.error(`[error] ${msg}`);
    updateMeta(store, tsIso, dateUtc, 0, 'error', msg);
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  if (!res.ok) {
    const msg = `HTTP ${res.status} from AviationStack.`;
    console.error(`[error] ${msg}`);
    updateMeta(store, tsIso, dateUtc, 0, 'error', msg);
    await atomicWriteJson(DATA_PATH, store);
    process.exit(1);
  }

  const records = Array.isArray(body.data) ? body.data : [];
  const flights = records.map(normaliseFlight);
  const latest = buildLatest(flights, tsIso);

  store.latest = latest;

  store.snapshots.push({ ts: tsIso, count: latest.flight_count });
  if (store.snapshots.length > MAX_SNAPSHOTS) {
    store.snapshots = store.snapshots.slice(-MAX_SNAPSHOTS);
  }

  const flightNumbers = flights.map((f) => f.flight);
  upsertDaily(store, dateUtc, latest, flightNumbers);

  updateMeta(store, tsIso, dateUtc, latest.flight_count, 'ok', null);

  await atomicWriteJson(DATA_PATH, store);

  const pagination = body.pagination || {};
  if (typeof pagination.total === 'number' && pagination.total > MAX_RECORDS_PER_REQUEST) {
    console.warn(
      `[warn] API reports ${pagination.total} total flights but pagination is not implemented. ` +
        `Some flights may be missed. Consider upgrading the plan.`,
    );
  }

  console.log(`[info] Snapshot captured: ${latest.flight_count} flights at ${tsIso}.`);
  console.log(`[info] By status: ${JSON.stringify(latest.by_status)}`);
  console.log(`[info] Top 3 origins: ${JSON.stringify(latest.by_origin.slice(0, 3))}`);
}

main().catch(async (err) => {
  const tsIso = nowIso();
  const dateUtc = tsIso.slice(0, 10);
  const msg = `Unhandled exception: ${err && err.message ? err.message : String(err)}`;
  console.error(`[error] ${msg}`);
  try {
    await writeErrorStub(DATA_PATH, msg, tsIso, dateUtc);
  } catch (writeErr) {
    console.error(`[error] Could not write error stub: ${writeErr.message}`);
  }
  process.exit(1);
});
