"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { TransferUploadZone } from "@/components/transfer-upload-zone"
import { TransferTable } from "@/components/transfer-table"
import { TransferStatCards } from "@/components/transfer-stat-cards"
import type { TransferBatch } from "@/lib/transfer-types"
import { ArrowLeft } from "lucide-react"

export default function TransfersPage() {
  const router = useRouter()
  const [batch, setBatch] = useState<TransferBatch | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [automationLogs, setAutomationLogs] = useState<string[]>([])

  const handleSend = async (transferIds: string[]) => {
    if (!batch) return
    setIsSending(true)
    setAutomationLogs([])
    try {
      const res = await fetch(`/api/transfers/${batch.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferIds }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.logs) {
          setAutomationLogs(data.logs)
        }
        // Re-fetch to get accurate statuses
        const batchRes = await fetch(`/api/transfers`)
        if (batchRes.ok) {
          const allBatches = await batchRes.json()
          const updatedBatch = allBatches.find((b: TransferBatch) => b.id === batch.id)
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
            <h1 className="text-2xl font-semibold text-foreground text-balance">Transferencias</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Suba una planilla Excel con los datos de sus transferencias bancarias
            </p>
          </div>

          {!batch ? (
            <div className="max-w-xl">
              <TransferUploadZone onUploadComplete={setBatch} />
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

              <TransferStatCards transfers={batch.transfers} />

              <TransferTable
                transfers={batch.transfers}
                batchId={batch.id}
                onSendTransfers={handleSend}
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
