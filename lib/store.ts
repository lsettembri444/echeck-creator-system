import fs from "fs"
import path from "path"
import type { UploadedBatch, CheckEntry } from "./types"

// Simple persistence to disk so you don't lose batches when the dev server restarts.
// NOTE: This is fine for local/dev. For multi-instance/prod, use a real DB.
const DATA_DIR = path.join(process.cwd(), ".data")
const STORE_FILE = path.join(DATA_DIR, "batches.json")

let batches: UploadedBatch[] = loadFromDisk()

function loadFromDisk(): UploadedBatch[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return []
    const raw = fs.readFileSync(STORE_FILE, "utf-8")
    const parsed = JSON.parse(raw) as UploadedBatch[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveToDisk(next: UploadedBatch[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = STORE_FILE + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8")
    fs.renameSync(tmp, STORE_FILE)
  } catch {
    // best-effort; keep app working even if filesystem is read-only
  }
}

function setBatches(next: UploadedBatch[]) {
  batches = next
  saveToDisk(batches)
}

export function getBatches(): UploadedBatch[] {
  return batches
}

export function getBatch(id: string): UploadedBatch | undefined {
  return batches.find((b) => b.id === id)
}

export function addBatch(batch: UploadedBatch): void {
  setBatches([...batches, batch])
}

export function updateCheck(
  batchId: string,
  checkId: string,
  updates: Partial<CheckEntry>
): CheckEntry | null {
  const batchIndex = batches.findIndex((b) => b.id === batchId)
  if (batchIndex === -1) return null

  const batch = batches[batchIndex]
  const checkIndex = batch.checks.findIndex((c) => c.id === checkId)
  if (checkIndex === -1) return null

  const updatedCheck: CheckEntry = { ...batch.checks[checkIndex], ...updates }
  const updatedBatch: UploadedBatch = {
    ...batch,
    checks: batch.checks.map((c, i) => (i === checkIndex ? updatedCheck : c)),
  }

  const next = batches.map((b, i) => (i === batchIndex ? updatedBatch : b))
  setBatches(next)

  return updatedCheck
}

export function getCheck(batchId: string, checkId: string): CheckEntry | null {
  const batch = batches.find((b) => b.id === batchId)
  if (!batch) return null
  return batch.checks.find((c) => c.id === checkId) ?? null
}

export function deleteBatch(id: string): boolean {
  const next = batches.filter((b) => b.id !== id)
  const changed = next.length !== batches.length
  if (changed) setBatches(next)
  return changed
}

export function clearAllBatches(): void {
  setBatches([])
}
