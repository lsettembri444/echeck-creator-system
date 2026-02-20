"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { UploadZone } from "@/components/upload-zone"
import { CheckTable } from "@/components/check-table"
import { StatCards } from "@/components/stat-cards"
import type { UploadedBatch } from "@/lib/types"
import { ArrowLeft } from "lucide-react"

export default function UploadPage() {
  const router = useRouter()
  const [batch, setBatch] = useState<UploadedBatch | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [automationLogs, setAutomationLogs] = useState<string[]>([])

  const handleSend = async (checkIds: string[]) => {
    if (!batch) return
    setIsSending(true)
    setAutomationLogs([])
    try {
      const res = await fetch(`/api/batches/${batch.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkIds }),
      })
      if (res.ok) {
        const data = await res.json()
        // Capture automation logs
        if (data.logs) {
          setAutomationLogs(data.logs)
        }
        // Update check statuses from server results
        setBatch((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            checks: prev.checks.map((c) => {
              const result = data.logs
                ? undefined
                : undefined
              // Find status from totalSent/totalFailed
              const sentCheckIds = checkIds
              if (sentCheckIds.includes(c.id)) {
                // Check if there were failures
                return { ...c, status: data.totalFailed > 0 ? "failed" as const : "sent" as const }
              }
              return c
            }),
          }
        })
        // Re-fetch to get accurate statuses
        const batchRes = await fetch(`/api/batches`)
        if (batchRes.ok) {
          const allBatches = await batchRes.json()
          const updatedBatch = allBatches.find((b: UploadedBatch) => b.id === batch.id)
          if (updatedBatch) setBatch(updatedBatch)
        }
      }
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground text-balance">Subir Lote</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Suba una planilla Excel con los datos de sus cheques
            </p>
          </div>

          {!batch ? (
            <div className="max-w-xl">
              <UploadZone onUploadComplete={setBatch} />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setBatch(null); setAutomationLogs([]) }}
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

              <StatCards checks={batch.checks} />

              <CheckTable
                checks={batch.checks}
                batchId={batch.id}
                onSendChecks={handleSend}
                isSending={isSending}
                automationLogs={automationLogs}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
