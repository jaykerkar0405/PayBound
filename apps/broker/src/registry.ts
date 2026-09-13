import { resourceRegistryEntrySchema, type ResourceRegistryEntry } from "@paybound/capability-spec";
import { pool, withTransaction } from "./db.js";

type Uuid = ResourceRegistryEntry["resourceId"];

/**
 * The closed, pre-vetted resource registry: resource_id -> recipient/price.
 * Populated once, out-of-band, before any agent run starts — there is no
 * runtime "add resource" path, per THREAT_MODEL.md's "no autonomous
 * discovery agent in the MVP."
 */
await pool.query(`
  CREATE TABLE IF NOT EXISTS resource_registry (
    resource_id TEXT PRIMARY KEY,
    recipient   TEXT NOT NULL,
    price       TEXT NOT NULL
  )
`);

interface ResourceRegistryRow {
  resource_id: string;
  recipient: string;
  price: string;
}

function rowToEntry(row: ResourceRegistryRow): ResourceRegistryEntry {
  return {
    resourceId: row.resource_id,
    recipient: row.recipient,
    price: row.price,
  };
}

/**
 * Seeds the registry with a fixed list of pre-vetted entries. Each entry is
 * validated against `resourceRegistryEntrySchema` before being written.
 * `resourceId` is the table's primary key, so seeding a duplicate throws
 * rather than silently overwriting or coexisting.
 */
export async function seedRegistry(entries: readonly ResourceRegistryEntry[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const entry of entries) {
      const validated = resourceRegistryEntrySchema.parse(entry);
      await client.query(
        "INSERT INTO resource_registry (resource_id, recipient, price) VALUES ($1, $2, $3)",
        [validated.resourceId, validated.recipient, validated.price],
      );
    }
  });
}

/**
 * Looks up a resource registry entry by `resourceId`. Returns `undefined` if
 * no entry with that id was ever seeded.
 */
export async function getResourceById(resourceId: Uuid): Promise<ResourceRegistryEntry | undefined> {
  const result = await pool.query<ResourceRegistryRow>(
    "SELECT resource_id, recipient, price FROM resource_registry WHERE resource_id = $1",
    [resourceId],
  );
  return result.rows[0] === undefined ? undefined : rowToEntry(result.rows[0]);
}
