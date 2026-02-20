export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { updateTransfer, getTransferBatch } from "@/lib/transfer-store"
import { ejecutarTransferencias } from "@/lib/transfer-automation"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params
    const body = await request.json()
    const { transferIds } = body as { transferIds?: string[] }

    const batch = getTransferBatch(batchId)
    if (!batch) {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 })
    }

    const targetTransfers = transferIds
      ? batch.transfers.filter((t) => transferIds.includes(t.id) && t.status === "pending")
      : batch.transfers.filter((t) => t.status === "pending")

    if (targetTransfers.length === 0) {
      return NextResponse.json(
        { error: "No hay transferencias pendientes para enviar." },
        { status: 400 }
      )
    }

    // Mark as processing
    for (const transfer of targetTransfers) {
      updateTransfer(batchId, transfer.id, { status: "processing", updatedAt: new Date().toISOString() })
    }

    // Execute real bank automation
    const automationResult = await ejecutarTransferencias(targetTransfers, { manualOtp: true })

    // Update statuses based on results
    for (const result of automationResult.results) {
      const nowIso = new Date().toISOString()
      updateTransfer(
        batchId,
        result.transferId,
        result.success
          ? { status: "sent", sentAt: nowIso, updatedAt: nowIso }
          : { status: "failed", updatedAt: nowIso }
      )
    }

    return NextResponse.json({
      message: `${automationResult.totalSent} transferencia(s) enviadas, ${automationResult.totalFailed} con error`,
      totalSent: automationResult.totalSent,
      totalFailed: automationResult.totalFailed,
      logs: automationResult.logs,
    })
  } catch (error) {
    console.error("[v0] Send transfer error:", error)
    return NextResponse.json({ error: "Error al enviar las transferencias" }, { status: 500 })
  }
}
