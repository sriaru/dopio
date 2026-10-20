import type { Entity } from "./types";
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function field(data: FormData, key: string, max: number, required = false) {
  const value = data.get(key);
  if (value !== null && typeof value !== "string")
    throw Error("Invalid " + key + ".");
  const text = (value ?? "").trim();
  if ((required && !text) || text.length > max)
    throw Error(`Please check ${key.replaceAll("_", " ")}.`);
  return text;
}
function choice(data: FormData, key: string, allowed: string[]) {
  const value = field(data, key, 40, true);
  if (!allowed.includes(value))
    throw Error("Please choose a valid " + key + ".");
  return value;
}
function optionalId(data: FormData, key: string, required = false) {
  const value = field(data, key, 36, required);
  if (value && !uuidPattern.test(value))
    throw Error("Please choose a valid " + key.replaceAll("_", " ") + ".");
  return value || null;
}
function date(data: FormData, key: string) {
  const value = field(data, key, 10);
  if (!value) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2199-12-31"
  )
    throw Error("Please enter a valid date.");
  const parsed = new Date(value + "T12:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw Error("Please enter a valid date.");
  return value;
}
export function validateEntity(value: unknown): asserts value is Entity {
  if (!["artist", "release", "task"].includes(String(value)))
    throw Error("Unknown record type.");
}
export function parseRecord(
  entity: Entity,
  data: FormData,
): Record<string, string | null> {
  validateEntity(entity);
  if (entity === "artist")
    return {
      name: field(data, "name", 100, true),
      genre: field(data, "genre", 100),
      status: choice(data, "status", ["Active", "On Hold"]),
    };
  if (entity === "release")
    return {
      title: field(data, "title", 150, true),
      artist_id: optionalId(data, "artist_id", true),
      format: choice(data, "format", ["Single", "EP", "Album", "Tour", "Campaign", "Video", "Partnership", "Other"]),
      release_date: date(data, "release_date"),
      status: choice(data, "status", [
        "Planning",
        "On track",
        "At risk",
        "Released",
      ]),
      notes: field(data, "notes", 5000),
      timing_notes: field(data,"timing_notes",1000),
    };
  return {
    title: field(data, "title", 150, true),
    artist_id: optionalId(data, "artist_id"),
    release_id: optionalId(data, "release_id"),
    due_date: date(data, "due_date"),
    status: choice(data, "status", ["Pending", "In progress", "Complete"]),
    priority: choice(data, "priority", ["Normal", "High"]),
    notes: field(data, "notes", 5000),
      timing_notes: field(data,"timing_notes",1000),
  };
}
