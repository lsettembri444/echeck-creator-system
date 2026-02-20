export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { updateCheck, getBatch } from "@/lib/store"
import { ejecutarEmisionCheques } from "@/lib/bank-automation"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
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

    // Execute real bank automation
    // Default: manual OTP so the browser window stays open while the user types the code.
    const automationResult = await ejecutarEmisionCheques(targetChecks, { manualOtp: true })

    // Update check statuses based on results
    for (const result of automationResult.results) {
      const nowIso = new Date().toISOString()
      updateCheck(
        batchId,
        result.checkId,
        result.success
          ? { status: "sent", sentAt: nowIso, updatedAt: nowIso }
          : { status: "failed", updatedAt: nowIso }
      )
    }

    return NextResponse.json({
      message: `${automationResult.totalSent} cheque(s) enviados, ${automationResult.totalFailed} con error`,
      totalSent: automationResult.totalSent,
      totalFailed: automationResult.totalFailed,
      logs: automationResult.logs,
    })
  } catch (error) {
    console.error("[v0] Send error:", error)
    return NextResponse.json({ error: "Error al enviar los cheques" }, { status: 500 })
  }
}
