export const runtime = "nodejs"
export const maxDuration = 3600 // 1 hour -- OTP entry is manual and can take several minutes

import { NextResponse } from "next/server"
import { updateCheck, getBatch } from "@/lib/store"
import { ejecutarEmisionCheques } from "@/lib/bank-automation"

/**
 * NDJSON streaming endpoint for cheque automation.
 * Each line is a JSON object: {"t":"log","d":"..."} or {"t":"done","d":{...}}
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params
  const body = await request.json()
  const { checkIds } = body as { checkIds?: string[] }

  const batch = getBatch(batchId)
  if (!batch) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 })
  }

  // Get target checks -- either specific IDs or all pending
  const targetChecks = checkIds
    ? batch.checks.filter((c) => checkIds.includes(c.id) && c.status === "pending")
    : batch.checks.filter((c) => c.status === "pending")

  if (targetChecks.length === 0) {
    return NextResponse.json(
      { error: "No hay cheques pendientes para enviar." },
      { status: 400 }
    )
  }

  // Mark as processing
  for (const check of targetChecks) {
    updateCheck(batchId, check.id, { status: "processing", updatedAt: new Date().toISOString() })
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
        // Execute real bank automation with real-time log streaming
        const automationResult = await ejecutarEmisionCheques(targetChecks, {
          manualOtp: true,
          logCallback: (line: string) => {
            sendLine("log", line)
          },
        })

        // Update check statuses and stream individual results
        const checkResults: Array<{ checkId: string; success: boolean; error?: string; payeeName?: string; amount?: number }> = []
        for (const result of automationResult.results) {
          const nowIso = new Date().toISOString()
          const check = targetChecks.find((c) => c.id === result.checkId)
          updateCheck(
            batchId,
            result.checkId,
            result.success
              ? { status: "sent", sentAt: nowIso, updatedAt: nowIso }
              : { status: "failed", updatedAt: nowIso }
          )
          const resultEntry = {
            checkId: result.checkId,
            success: result.success,
            error: result.error,
            payeeName: check?.payeeName,
            amount: check?.amount,
          }
          checkResults.push(resultEntry)
          sendLine("result", resultEntry)
        }

        sendLine("done", {
          message: `${automationResult.totalSent} cheque(s) enviados, ${automationResult.totalFailed} con error`,
          totalSent: automationResult.totalSent,
          totalFailed: automationResult.totalFailed,
          results: checkResults,
        })
      } catch (error) {
        console.error("[v0] Send cheque stream error:", error)
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
