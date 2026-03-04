export const runtime = "nodejs"
export const maxDuration = 3600 // 1 hour -- OTP entry is manual and can take several minutes

import { NextResponse } from "next/server"
import { updateTransfer, getTransferBatch } from "@/lib/transfer-store"
import { ejecutarTransferencias } from "@/lib/transfer-automation"

/**
 * NDJSON streaming endpoint for transfer automation.
 * Each line is a JSON object: {"t":"log","d":"..."} or {"t":"done","d":{...}}
 * NDJSON is simpler and more robust than SSE for streaming over fetch.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params
  const body = await request.json()
  const { transferIds, batchDate, isLastBatch } = body as { transferIds?: string[]; batchDate?: string; isLastBatch?: boolean }

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

  // Determine the batch date: use explicit batchDate param, or extract from transfers
  // All transfers in a single request MUST share the same date (bank limitation)
  const uniqueDates = [...new Set(targetTransfers.map((t) => t.paymentDate).filter(Boolean))]
  const resolvedDate = batchDate || uniqueDates[0] || ""

  if (!resolvedDate) {
    return NextResponse.json(
      { error: "No se especifico fecha de envio. Todas las transferencias deben tener una fecha." },
      { status: 400 }
    )
  }

  if (uniqueDates.length > 1 && !batchDate) {
    return NextResponse.json(
      {
        error: `Las transferencias tienen ${uniqueDates.length} fechas diferentes (${uniqueDates.join(", ")}). El banco solo permite una fecha por lote. Envie cada fecha por separado.`,
      },
      { status: 400 }
    )
  }

  // Mark as processing
  for (const transfer of targetTransfers) {
    updateTransfer(batchId, transfer.id, {
      status: "processing",
      updatedAt: new Date().toISOString(),
    })
  }

  // Create NDJSON stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendLine = (type: string, data: unknown) => {
        try {
          const json = JSON.stringify({ t: type, d: data })
          controller.enqueue(encoder.encode(json + "\n"))
        } catch {
          // Stream may be closed
        }
      }

      try {
        const automationResult = await ejecutarTransferencias(
          targetTransfers,
          resolvedDate,
          {
            manualOtp: true,
            isLastBatch: isLastBatch ?? false,
            logCallback: (line: string) => {
              sendLine("log", line)
            },
          }
        )

        // Update statuses in server store and stream results to UI
        const transferResults: Array<{ transferId: string; success: boolean; error?: string; providerName?: string; amount?: number }> = []
        for (const result of automationResult.results) {
          const nowIso = new Date().toISOString()
          const transfer = targetTransfers.find(t => t.id === result.transferId)
          updateTransfer(
            batchId,
            result.transferId,
            result.success
              ? { status: "sent", sentAt: nowIso, updatedAt: nowIso }
              : { status: "failed", updatedAt: nowIso }
          )
          const resultEntry = {
            transferId: result.transferId,
            success: result.success,
            error: result.error,
            providerName: transfer?.providerName,
            amount: transfer?.amount,
          }
          transferResults.push(resultEntry)
          // Send individual result so UI can update per-transfer in real-time
          sendLine("result", resultEntry)
        }

        // Save operation log for history
        try {
          const { addTransferOperationLog } = await import("@/lib/transfer-store")
          addTransferOperationLog({
            id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            batchId,
            batchDate: resolvedDate,
            executedAt: new Date().toISOString(),
            totalSent: automationResult.totalSent,
            totalFailed: automationResult.totalFailed,
            totalAmount: targetTransfers.reduce((s, t) => s + t.amount, 0),
            bankOperationId: automationResult.bankOperationId,
            transfers: transferResults.map(r => ({
              providerName: r.providerName || "Desconocido",
              cbu: targetTransfers.find(t => t.id === r.transferId)?.cbu || "",
              amount: r.amount || 0,
              success: r.success,
              error: r.error,
            })),
          })
        } catch (e) {
          console.error("[v0] Failed to save operation log:", e)
        }

        sendLine("done", {
          message: `${automationResult.totalSent} transferencia(s) enviadas, ${automationResult.totalFailed} con error`,
          totalSent: automationResult.totalSent,
          totalFailed: automationResult.totalFailed,
          results: transferResults,
          bankOperationId: automationResult.bankOperationId,
        })
      } catch (error) {
        console.error("[v0] Send transfer stream error:", error)
        const errorMsg = error instanceof Error ? error.message : String(error)
        sendLine("error", { error: `Error al enviar: ${errorMsg}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
