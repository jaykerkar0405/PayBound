import { resourceRegistryEntrySchema, type ResourceRegistryEntry } from "@paybound/capability-spec";
import { db } from "./db.js";

type Uuid = ResourceRegistryEntry["resourceId"];

/**
 * The closed, pre-vetted resource registry: resource_id -> recipient/price.
 * Populated once, out-of-band, before any agent run starts — there is no
 * runtime "add resource" path, per THREAT_MODEL.md's "no autonomous
 * discovery agent in the MVP."
 */
db.exec(`
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

const insertStatement = db.prepare<[string, string, string]>(
  "INSERT INTO resource_registry (resource_id, recipient, price) VALUES (?, ?, ?)",
);

const selectByIdStatement = db.prepare<[string], ResourceRegistryRow>(
  "SELECT resource_id, recipient, price FROM resource_registry WHERE resource_id = ?",
);

/**
 * Seeds the registry with a fixed list of pre-vetted entries. Each entry is
 * validated against `resourceRegistryEntrySchema` before being written.
 * `resourceId` is the table's primary key, so seeding a duplicate throws
 * rather than silently overwriting or coexisting.
 */
export function seedRegistry(entries: readonly ResourceRegistryEntry[]): void {
  const seedTransaction = db.transaction((entriesToInsert: readonly ResourceRegistryEntry[]) => {
    for (const entry of entriesToInsert) {
      const validated = resourceRegistryEntrySchema.parse(entry);
      insertStatement.run(validated.resourceId, validated.recipient, validated.price);
    }
  });

  seedTransaction(entries);
}

/**
 * Looks up a resource registry entry by `resourceId`. Returns `undefined` if
 * no entry with that id was ever seeded.
 */
export function getResourceById(resourceId: Uuid): ResourceRegistryEntry | undefined {
  const row = selectByIdStatement.get(resourceId);
  return row === undefined ? undefined : rowToEntry(row);
}
