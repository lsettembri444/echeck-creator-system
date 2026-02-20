"use client"

import { FileSpreadsheet, ChevronRight, CheckCircle2, Clock } from "lucide-react"
import type { UploadedBatch } from "@/lib/types"

interface BatchListProps {
  batches: UploadedBatch[]
  onSelectBatch: (batch: UploadedBatch) => void
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)

export function BatchList({ batches, onSelectBatch }: BatchListProps) {
  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("es-AR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16">
        <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium text-muted-foreground">Sin lotes todavia</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Suba un archivo Excel para comenzar</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {batches.map((batch) => {
        const sentCount = batch.checks.filter((c) => c.status === "sent").length
        const pendingCount = batch.checks.filter((c) => c.status === "pending").length
        const allSent = sentCount === batch.checks.length

        return (
          <button
            key={batch.id}
            onClick={() => onSelectBatch(batch)}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-card-foreground">{batch.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {batch.checks.length} cheques &middot; {formatCurrency(batch.totalAmount)} &middot;{" "}
                  {formatDate(batch.uploadedAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {allSent ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Todos enviados
                </span>
              ) : pendingCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  {pendingCount} pendientes
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {sentCount}/{batch.checks.length} enviados
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
        )
      })}
    </div>
  )
}
