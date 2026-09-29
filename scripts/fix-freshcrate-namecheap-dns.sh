#!/usr/bin/env bash
set -euo pipefail

NAMECHEAP_ENV_FILE="${NAMECHEAP_ENV_FILE:-/home/stathis/domain-flipper/.env}"
if [[ ! -f "$NAMECHEAP_ENV_FILE" ]]; then
  echo "Missing env file: $NAMECHEAP_ENV_FILE" >&2
  exit 1
fi

set -a
source "$NAMECHEAP_ENV_FILE"
set +a

export NAMECHEAP_USER NAMECHEAP_API_KEY NAMECHEAP_CLIENT_IP NAMECHEAP_SANDBOX

node --input-type=module <<'NODE'
import { NamecheapClient } from '/home/stathis/quickship/src/api/namecheap.ts';

const auth = {
  apiUser: process.env.NAMECHEAP_USER,
  username: process.env.NAMECHEAP_USER,
  apiKey: process.env.NAMECHEAP_API_KEY,
  clientIp: process.env.NAMECHEAP_CLIENT_IP,
  sandbox: String(process.env.NAMECHEAP_SANDBOX).toLowerCase() === 'true',
};

const client = new NamecheapClient(auth);
const domain = 'freshcrate.ai';
const apexA = '66.33.22.234';
const apexVerify = 'railway-verify=84ac007117e58f7c9ceb9af09bcd58a37f618d82a0484bacff8187cb642ea397';
const wwwCname = 'rhbv6k8f.up.railway.app.';
const wwwVerify = 'railway-verify=d9c653ffd22038f1687a2adcb83f88751e8a72ea41ba55a2708096c0bdd2c6b8';

const existing = await client.getHosts(domain);
const filtered = existing.filter((h) => {
  if (h.hostname === '@' && (
    h.type === 'A' || h.type === 'ALIAS' || h.type === 'CNAME' || h.type === 'TXT' || h.type === 'URL301' || h.type === 'URL'
  )) return false;
  if (h.hostname === 'www' && (
    h.type === 'A' || h.type === 'ALIAS' || h.type === 'CNAME' || h.type === 'TXT' || h.type === 'URL301' || h.type === 'URL'
  )) return false;
  if (h.hostname === '_railway-verify' && h.type === 'TXT') return false;
  if (h.hostname === '_railway-verify.www' && h.type === 'TXT') return false;
  return true;
});

const nextHosts = [
  ...filtered,
  { hostname: '@', type: 'A', address: apexA, ttl: 300 },
  { hostname: '_railway-verify', type: 'TXT', address: apexVerify, ttl: 1800 },
  { hostname: 'www', type: 'CNAME', address: wwwCname, ttl: 1800 },
  { hostname: '_railway-verify.www', type: 'TXT', address: wwwVerify, ttl: 1800 },
];

await client.setHosts({ domain, hosts: nextHosts });
console.log(JSON.stringify({ ok: true, domain, kept: filtered.length, total: nextHosts.length, nextHosts }, null, 2));
NODE
