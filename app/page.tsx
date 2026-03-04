"use client"

import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { useRouter, useSearchParams } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { StatCards } from "@/components/stat-cards"
import { TransferStatCards } from "@/components/transfer-stat-cards"
import { BatchList } from "@/components/batch-list"
import { CheckTable } from "@/components/check-table"
import { ArrowLeft, RefreshCw, FileSpreadsheet, ChevronRight, CheckCircle2, Clock, Trash2 } from "lucide-react"
import type { UploadedBatch } from "@/lib/types"
import type { TransferBatch } from "@/lib/transfer-types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: batches = [], mutate } = useSWR<UploadedBatch[]>("/api/batches", fetcher, {
    refreshInterval: 5000,
  })
  const { data: transferBatches = [], mutate: mutateTransfers } = useSWR<TransferBatch[]>(
    "/api/transfers",
    fetcher,
    { refreshInterval: 5000 }
  )
  const [selectedBatch, setSelectedBatch] = useState<UploadedBatch | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [automationLogs, setAutomationLogs] = useState<string[]>([])
  const [isDeleting, setIsDeleting] = useState(false)

  // Auto-select batch from ?batch=ID query param (e.g. from invoice creation)
  useEffect(() => {
    const batchId = searchParams.get("batch")
    if (batchId && batches.length > 0 && !selectedBatch) {
      const found = batches.find((b) => b.id === batchId)
      if (found) {
        setSelectedBatch(found)
        // Clean up URL
        router.replace("/", { scroll: false })
      }
    }
  }, [searchParams, batches, selectedBatch, router])

  const allChecks = batches.flatMap((b) => b.checks)

  // Keep selected batch in sync with SWR data
  const activeBatch = selectedBatch
    ? batches.find((b) => b.id === selectedBatch.id) ?? selectedBatch
    : null

  const handleSend = useCallback(
    async (checkIds: string[]) => {
      if (!activeBatch) return
      setIsSending(true)
      setAutomationLogs([])
      try {
        const res = await fetch(`/api/batches/${activeBatch.id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkIds }),
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

            const parts = buffer.split("\n")
            buffer = parts.pop() || ""

            for (const line of parts) {
              const trimmed = line.trim()
              if (!trimmed) continue
              try {
                const msg = JSON.parse(trimmed)
                if (msg.t === "log" && typeof msg.d === "string") {
                  setAutomationLogs((prev) => [...prev, msg.d])
                } else if (msg.t === "result" && msg.d) {
                  // Update individual check status in local state
                  setSelectedBatch((prev) => {
                    if (!prev) return prev
                    return {
                      ...prev,
                      checks: prev.checks.map((c) =>
                        c.id === msg.d.checkId
                          ? { ...c, status: msg.d.success ? "sent" as const : "failed" as const }
                          : c
                      ),
                    }
                  })
                } else if (msg.t === "done" && msg.d) {
                  if (msg.d.results && Array.isArray(msg.d.results)) {
                    setSelectedBatch((prev) => {
                      if (!prev) return prev
                      const resultMap = new Map(
                        msg.d.results.map((r: { checkId: string; success: boolean }) => [r.checkId, r.success])
                      )
                      return {
                        ...prev,
                        checks: prev.checks.map((c) => {
                          const success = resultMap.get(c.id)
                          if (success === undefined) return c
                          return { ...c, status: success ? "sent" as const : "failed" as const }
                        }),
                      }
                    })
                  }
                } else if (msg.t === "error" && msg.d) {
                  setAutomationLogs((prev) => [...prev, `ERROR: ${msg.d.error || JSON.stringify(msg.d)}`])
                }
              } catch {
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
        // Re-fetch batch from server to ensure local state is in sync
        mutate()
        setIsSending(false)
      }
    },
    [activeBatch, mutate]
  )

  const handleCancelBatch = useCallback(async () => {
    if (!activeBatch) return
    const confirmed = window.confirm(
      `Eliminar el lote "${activeBatch.fileName}" con ${activeBatch.checks.length} cheque(s)?\n\nEsta accion no se puede deshacer.`
    )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/batches/${activeBatch.id}`, { method: "DELETE" })
      if (res.ok) {
        setSelectedBatch(null)
        setAutomationLogs([])
        mutate()
      }
    } finally {
      setIsDeleting(false)
    }
  }, [activeBatch, mutate])

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              {activeBatch ? (
                <button
                  onClick={() => { setSelectedBatch(null); setAutomationLogs([]) }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver al panel
                </button>
              ) : null}
              <h1 className="text-2xl font-semibold text-foreground text-balance">
                {activeBatch ? activeBatch.fileName : "Panel"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeBatch
                  ? `${activeBatch.checks.length} cheques en este lote`
                  : "Administre sus lotes de cheques electronicos"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeBatch && (
                <button
                  onClick={handleCancelBatch}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  aria-label="Cancelar lote"
                >
                  <Trash2 className="h-4 w-4" />
                  {isDeleting ? "Eliminando..." : "Cancelar lote"}
                </button>
              )}
              <button
                onClick={() => { mutate(); mutateTransfers() }}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Actualizar datos"
              >
                <RefreshCw className="h-4 w-4" />
                Actualizar
              </button>
            </div>
          </div>

          {activeBatch ? (
            /* Batch detail view */
            <CheckTable
              checks={activeBatch.checks}
              batchId={activeBatch.id}
              onSendChecks={handleSend}
              isSending={isSending}
              automationLogs={automationLogs}
            />
          ) : (
            /* Overview */
            <div className="flex flex-col gap-8">
              {/* Cheques Section */}
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-4">Cheques</h2>
                <div className="flex flex-col gap-4">
                  <StatCards checks={allChecks} />
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Lotes Recientes</h3>
                    <BatchList batches={batches} onSelectBatch={setSelectedBatch} />
                  </div>
                </div>
              </section>

              {/* Transfers Section */}
              <section>
                <h2 className="text-lg font-semibold text-foreground mb-4">Transferencias</h2>
                <div className="flex flex-col gap-4">
                  <TransferStatCards transfers={transferBatches.flatMap((b) => b.transfers)} />
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Lotes Recientes</h3>
                    {transferBatches.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-12">
                        <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm font-medium text-muted-foreground">Sin lotes de transferencias</p>
                        <p className="mt-1 text-xs text-muted-foreground/70">Suba un archivo Excel en la seccion Transferencias</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {transferBatches.map((tb) => {
                          const sentCount = tb.transfers.filter((t) => t.status === "sent").length
                          const pendingCount = tb.transfers.filter((t) => t.status === "pending").length
                          const allSent = sentCount === tb.transfers.length && tb.transfers.length > 0
                          return (
                            <button
                              key={tb.id}
                              onClick={() => router.push("/transfers")}
                              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-card-foreground">{tb.fileName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {tb.transfers.length} transferencias &middot; {formatCurrency(tb.totalAmount)} &middot;{" "}
                                    {new Date(tb.uploadedAt).toLocaleDateString("es-AR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {allSent ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Todas enviadas
                                  </span>
                                ) : pendingCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                                    <Clock className="h-3.5 w-3.5" />
                                    {pendingCount} pendientes
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {sentCount}/{tb.transfers.length} enviadas
                                  </span>
                                )}
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
