import fs from "fs"
import path from "path"
import type { TransferBatch, TransferEntry } from "./transfer-types"

const DATA_DIR = path.join(process.cwd(), ".data")
const STORE_FILE = path.join(DATA_DIR, "transfer-batches.json")

let batches: TransferBatch[] = loadFromDisk()

function loadFromDisk(): TransferBatch[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return []
    const raw = fs.readFileSync(STORE_FILE, "utf-8")
    const parsed = JSON.parse(raw) as TransferBatch[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveToDisk(next: TransferBatch[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = STORE_FILE + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8")
    fs.renameSync(tmp, STORE_FILE)
  } catch {
    // best-effort
  }
}

function setBatches(next: TransferBatch[]) {
  batches = next
  saveToDisk(batches)
}

export function getTransferBatches(): TransferBatch[] {
  return batches
}

export function getTransferBatch(id: string): TransferBatch | undefined {
  return batches.find((b) => b.id === id)
}

export function addTransferBatch(batch: TransferBatch): void {
  setBatches([...batches, batch])
}

export function updateTransfer(
  batchId: string,
  transferId: string,
  updates: Partial<TransferEntry>
): TransferEntry | null {
  const batchIndex = batches.findIndex((b) => b.id === batchId)
  if (batchIndex === -1) return null

  const batch = batches[batchIndex]
  const transferIndex = batch.transfers.findIndex((t) => t.id === transferId)
  if (transferIndex === -1) return null

  const updatedTransfer: TransferEntry = { ...batch.transfers[transferIndex], ...updates }
  const updatedBatch: TransferBatch = {
    ...batch,
    transfers: batch.transfers.map((t, i) => (i === transferIndex ? updatedTransfer : t)),
  }

  const next = batches.map((b, i) => (i === batchIndex ? updatedBatch : b))
  setBatches(next)

  return updatedTransfer
}

export function deleteTransferBatch(id: string): boolean {
  const next = batches.filter((b) => b.id !== id)
  const changed = next.length !== batches.length
  if (changed) setBatches(next)
  return changed
}

export function clearAllTransferBatches(): void {
  setBatches([])
}
