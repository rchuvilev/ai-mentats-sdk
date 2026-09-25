'use strict';
//
// cloudflared config parsing and rendering, over an ingress LIST.
//
// WHY A LIST AND NOT ONE SERVICE
// ------------------------------
// n8n tunnels one HTTP service (localhost:5678); minecraft one UDP service
// (localhost:19132, RakNet); coolify TWO — its web UI on http://localhost:8000
// AND ssh://localhost:2222. An API shaped around a single service would have
// served two of the three apps and silently broken the third.
//
// WHY ENTRIES ARE PARSED WHOLE
// ----------------------------
// The shipped implementations scanned for a line matching the service URL and
// took the hostname from the line ABOVE it. A hand-edited entry with the keys
// in the other order —
//
//     - service: http://localhost:5678
//       hostname: n8n.example.com
//
// — is valid YAML that cloudflared honours, and it read as "no tunnel
// configured"; the app then offered to create a second tunnel over a working
// one. Parsing whole entries fixes that class of bug.
//
// This is deliberately not a full YAML parser: no dependency is worth it here,
// and a partial parse must never throw — a bad config reads as "not
// configured", it does not crash the tunnel tab.

const CLOUDFLARED_SERVICE_404 = 'http_status:404';

/** Strip a trailing `# comment` and surrounding quotes/space from a scalar. */
function cleanScalar(raw) {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  // '#' only starts a comment at the start or after whitespace, so a legal
  // value like `a#b` survives.
  const hash = v.search(/(^|\s)#/);
  if (hash !== -1) v = v.slice(0, hash === 0 ? 0 : hash).trim();
  return v.replace(/^["']|["']$/g, '').trim();
}

function applyKey(entry, key, value) {
  const v = cleanScalar(value);
  if (key === 'hostname') entry.hostname = v || null;
  if (key === 'service') entry.service = v || null;
}

/** `udp://127.0.0.1:19132` and `udp://localhost:19132` mean the same thing. */
function normalizeService(service) {
  return String(service).trim().replace('127.0.0.1', 'localhost').replace(/\/+$/, '');
}

function parseTunnelConfig(text) {
  const empty = { tunnel: null, credentialsFile: null, ingress: [] };
  if (typeof text !== 'string' || !text.trim()) return empty;

  let tunnel = null;
  let credentialsFile = null;
  const ingress = [];
  let inIngress = false;
  let current = null;

  const pushCurrent = () => {
    if (current) ingress.push(current);
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    // A top-level key is unindented, and reaching one ends the ingress block.
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      pushCurrent();
      inIngress = top[1] === 'ingress';
      if (top[1] === 'tunnel') tunnel = cleanScalar(top[2]) || null;
      if (top[1] === 'credentials-file') credentialsFile = cleanScalar(top[2]) || null;
      continue;
    }
    if (!inIngress) continue;

    // `- hostname: x` / `- service: y` opens a new entry.
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item) {
      pushCurrent();
      current = { hostname: null, service: null };
      const inline = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (inline) applyKey(current, inline[1], inline[2]);
      continue;
    }

    // A continuation key belongs to the entry opened above it. Order-free.
    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && current) applyKey(current, kv[1], kv[2]);
  }
  pushCurrent();

  return { tunnel, credentialsFile, ingress };
}

/** The hostname routed to `scheme://localhost:port`, or null. */
function findIngress(config, { scheme, port }) {
  const wanted = normalizeService(`${scheme}://localhost:${port}`);
  const match = (config.ingress || []).find(
    (e) => e.service && normalizeService(e.service) === wanted && e.hostname,
  );
  return match ? match.hostname : null;
}

/**
 * A tunnel is configured only when it has an id AND a hostname for EVERY
 * service the app declares. A partially configured two-service tunnel would
 * otherwise report ready and then fail to route half its traffic.
 */
function isConfigured(config, services) {
  if (!config || !config.tunnel) return false;
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.every((s) => findIngress(config, s) !== null);
}

/**
 * Render the config.yml this family manages.
 * The trailing `http_status:404` is mandatory — cloudflared refuses to start
 * a config whose ingress list has no final catch-all.
 */
function renderTunnelConfig({ tunnelId, credentialsFile, ingress }) {
  if (!tunnelId) throw new Error('renderTunnelConfig: tunnelId is required');
  if (!Array.isArray(ingress) || ingress.length === 0) {
    throw new Error('renderTunnelConfig: ingress must be a non-empty array');
  }
  const lines = [`tunnel: ${tunnelId}`, `credentials-file: ${credentialsFile}`, '', 'ingress:'];
  for (const entry of ingress) {
    if (!entry.hostname) throw new Error('renderTunnelConfig: every ingress entry needs a hostname');
    lines.push(`  - hostname: ${entry.hostname}`);
    lines.push(`    service: ${entry.scheme}://localhost:${entry.port}`);
  }
  lines.push(`  - service: ${CLOUDFLARED_SERVICE_404}`, '', 'metrics: 127.0.0.1:0', '');
  return lines.join('\n');
}

/** Pull the tunnel UUID out of `cloudflared tunnel create` output. */
function parseTunnelId(output) {
  const m = String(output || '').match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

/**
 * Reject anything that is not a plain DNS hostname. This value reaches
 * `cloudflared tunnel route dns` and the generated YAML, so an unvalidated
 * string is an injection point as well as a corrupt-config source.
 */
function isValidHostname(value) {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (!host || host.length > 253) return false;
  if (host.startsWith('-') || host.endsWith('-') || host.endsWith('.')) return false;
  // At least one dot: a tunnel must point at a real FQDN.
  if (!host.includes('.')) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}

/** cloudflared logs this once a connection is registered with the edge. */
function isTunnelConnectedLine(text) {
  return typeof text === 'string' && text.includes('Registered tunnel connection');
}

module.exports = {
  CLOUDFLARED_SERVICE_404,
  cleanScalar,
  normalizeService,
  parseTunnelConfig,
  findIngress,
  isConfigured,
  renderTunnelConfig,
  parseTunnelId,
  isValidHostname,
  isTunnelConnectedLine,
};
