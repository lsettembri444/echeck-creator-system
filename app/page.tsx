"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { AppSidebar } from "@/components/app-sidebar"
import { StatCards } from "@/components/stat-cards"
import { BatchList } from "@/components/batch-list"
import { CheckTable } from "@/components/check-table"
import { ArrowLeft, RefreshCw } from "lucide-react"
import type { UploadedBatch } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function DashboardPage() {
  const { data: batches = [], mutate } = useSWR<UploadedBatch[]>("/api/batches", fetcher, {
    refreshInterval: 5000,
  })
  const [selectedBatch, setSelectedBatch] = useState<UploadedBatch | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [automationLogs, setAutomationLogs] = useState<string[]>([])

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
        if (res.ok) {
          const data = await res.json()
          if (data.logs) {
            setAutomationLogs(data.logs)
          }
        }
        mutate()
      } finally {
        setIsSending(false)
      }
    },
    [activeBatch, mutate]
  )

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
            <button
              onClick={() => mutate()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Actualizar datos"
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </button>
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
            <div className="flex flex-col gap-6">
              <StatCards checks={allChecks} />
              <div>
                <h2 className="text-base font-semibold text-foreground mb-3">Lotes Recientes</h2>
                <BatchList batches={batches} onSelectBatch={setSelectedBatch} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
