import type { Scoped } from '@/lib/db';

// The connector clients the signed-in person has authorized (db/012), for
// Account › Security, and revoking them (REQUIREMENTS M-1, AC-11).

export interface Connection {
  clientId: string;
  /** The client's host, as the consent screen named it. */
  host: string;
  connectedAt: string;
}

export async function listConnections(db: Scoped): Promise<Connection[]> {
  const rows = await db.q('select client_id, connected_at from my_connector_clients()');
  return rows.map((r) => {
    const clientId = String(r.client_id);
    let host = clientId;
    try {
      host = new URL(clientId).host;
    } catch {
      // keep the id as it is
    }
    const at = r.connected_at;
    return { clientId, host, connectedAt: at instanceof Date ? at.toISOString() : String(at) };
  });
}

export async function revokeConnection(db: Scoped, clientId: string | null): Promise<number> {
  const rows = await db.q('select oauth_revoke_mine($1) as n', [clientId]);
  return Number(rows[0]?.n ?? 0);
}
