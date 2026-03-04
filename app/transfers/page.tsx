"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { TransferUploadZone } from "@/components/transfer-upload-zone"
import { TransferTable } from "@/components/transfer-table"
import { TransferStatCards } from "@/components/transfer-stat-cards"
import type { TransferBatch } from "@/lib/transfer-types"
import { ArrowLeft, Loader2 } from "lucide-react"

export default function TransfersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [batch, setBatch] = useState<TransferBatch | null>(null)
  const [loadingBatch, setLoadingBatch] = useState(false)
  const [sendingDate, setSendingDate] = useState<string | null>(null)
  const [automationLogs, setAutomationLogs] = useState<string[]>([])

  // Load batch from query parameter (e.g., when redirected from Facturas page)
  useEffect(() => {
    const batchId = searchParams.get("batch")
    if (!batchId || batch) return

    setLoadingBatch(true)
    fetch("/api/transfers")
      .then((res) => res.ok ? res.json() : [])
      .then((batches: TransferBatch[]) => {
        const found = batches.find((b) => b.id === batchId)
        if (found) setBatch(found)
      })
      .catch(() => {})
      .finally(() => setLoadingBatch(false))
  }, [searchParams, batch])

  const handleSendDateGroup = async (date: string, transferIds: string[]) => {
    if (!batch || transferIds.length === 0) return
    setSendingDate(date)
    setAutomationLogs([])

    // Determine if this is the last pending date group
    // so the automation can close the browser after completion
    const pendingTransfers = batch.transfers.filter((t) => t.status === "pending")
    const pendingDates = [...new Set(pendingTransfers.map((t) => t.paymentDate))]
    const isLastBatch = pendingDates.length <= 1

    try {
      const res = await fetch(`/api/transfers/${batch.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferIds, batchDate: date, isLastBatch }),
      })

      const contentType = res.headers.get("content-type") || ""

      if (contentType.includes("ndjson") && res.body) {
        // NDJSON stream: each line is {"t":"log"|"done"|"error", "d":...}
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Split into complete lines
          const parts = buffer.split("\n")
          // Last part may be incomplete, keep it in buffer
          buffer = parts.pop() || ""

          for (const line of parts) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const msg = JSON.parse(trimmed)
              if (msg.t === "log" && typeof msg.d === "string") {
                setAutomationLogs((prev) => [...prev, msg.d])
              } else if (msg.t === "result" && msg.d) {
                // Update individual transfer status in local state immediately
                setBatch((prev) => {
                  if (!prev) return prev
                  return {
                    ...prev,
                    transfers: prev.transfers.map((t) =>
                      t.id === msg.d.transferId
                        ? { ...t, status: msg.d.success ? "sent" as const : "failed" as const }
                        : t
                    ),
                  }
                })
              } else if (msg.t === "done" && msg.d) {
                // Update all transfer statuses from results (in case "result" events were missed)
                if (msg.d.results && Array.isArray(msg.d.results)) {
                  setBatch((prev) => {
                    if (!prev) return prev
                    const resultMap = new Map(
                      msg.d.results.map((r: { transferId: string; success: boolean }) => [r.transferId, r.success])
                    )
                    return {
                      ...prev,
                      transfers: prev.transfers.map((t) => {
                        const success = resultMap.get(t.id)
                        if (success === undefined) return t
                        return { ...t, status: success ? "sent" as const : "failed" as const }
                      }),
                    }
                  })
                }
              } else if (msg.t === "error" && msg.d) {
                setAutomationLogs((prev) => [...prev, `ERROR: ${msg.d.error || JSON.stringify(msg.d)}`])
              }
            } catch {
              // Not valid JSON -- show raw text
              if (trimmed) setAutomationLogs((prev) => [...prev, trimmed])
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const msg = JSON.parse(buffer.trim())
            if (msg.t === "log") {
              setAutomationLogs((prev) => [...prev, msg.d])
            } else if (msg.t === "result" && msg.d) {
              setBatch((prev) => {
                if (!prev) return prev
                return {
                  ...prev,
                  transfers: prev.transfers.map((t) =>
                    t.id === msg.d.transferId
                      ? { ...t, status: msg.d.success ? "sent" as const : "failed" as const }
                      : t
                  ),
                }
              })
            } else if (msg.t === "done" && msg.d?.results) {
              setBatch((prev) => {
                if (!prev) return prev
                const resultMap = new Map(
                  msg.d.results.map((r: { transferId: string; success: boolean }) => [r.transferId, r.success])
                )
                return {
                  ...prev,
                  transfers: prev.transfers.map((t) => {
                    const success = resultMap.get(t.id)
                    if (success === undefined) return t
                    return { ...t, status: success ? "sent" as const : "failed" as const }
                  }),
                }
              })
            } else if (msg.t === "error") {
              setAutomationLogs((prev) => [...prev, `ERROR: ${msg.d?.error}`])
            }
          } catch { /* ignore incomplete */ }
        }
      } else {
        // Fallback: plain JSON response (error cases like 400, 404)
        const data = await res.json().catch(() => null)
        if (data?.logs) setAutomationLogs(data.logs)
        if (data?.error) setAutomationLogs((prev) => [...prev, `ERROR: ${data.error}`])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAutomationLogs((prev) => [...prev, `ERROR de conexion: ${msg}`])
    } finally {
      // Always re-fetch batch from server to ensure local state is in sync
      // This is the safety net in case stream events were missed
      try {
        const batchRes = await fetch("/api/transfers")
        if (batchRes.ok) {
          const allBatches = await batchRes.json()
          const updatedBatch = allBatches.find((b: TransferBatch) => b.id === batch.id)
          if (updatedBatch) setBatch(updatedBatch)
        }
      } catch {
        // best-effort
      }
      setSendingDate(null)
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground text-balance">Transferencias</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Suba una planilla Excel con los datos de sus transferencias bancarias
            </p>
          </div>

          {loadingBatch ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !batch ? (
            <div className="mx-auto max-w-xl">
              <TransferUploadZone onUploadComplete={setBatch} />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setBatch(null); setAutomationLogs([]); setSendingDate(null) }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Subir otro archivo
                </button>
                <button
                  onClick={() => router.push("/")}
                  className="text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  Ir al Panel
                </button>
              </div>

              <TransferStatCards transfers={batch.transfers} />

              <TransferTable
                transfers={batch.transfers}
                batchId={batch.id}
                onSendDateGroup={handleSendDateGroup}
                sendingDate={sendingDate}
                automationLogs={automationLogs}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
