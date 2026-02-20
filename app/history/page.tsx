"use client"

import useSWR from "swr"
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { FileSpreadsheet, CheckCircle2, Clock, DollarSign } from "lucide-react"
import type { UploadedBatch, CheckEntry } from "@/lib/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)

export default function HistoryPage() {
  const { data: batches = [], mutate } = useSWR<UploadedBatch[]>("/api/batches", fetcher)

const resetHistory = async () => {
  const res = await fetch("/api/batches/reset", { method: "POST" })
  if (!res.ok) throw new Error("No se pudo reiniciar el historial")
  await mutate()
}

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

  const allChecks = batches.flatMap((b) => b.checks)
  const totalSent = allChecks.filter((c) => c.status === "sent")
  const totalAmountSent = totalSent.reduce((s, c) => s + c.amount, 0)

  // Backwards compatibility: early versions stored paymentDate as DD/MM/YYYY.
  const normalizePaymentDateToISO = (dateStr: string): string => {
    const s = (dateStr || "").trim()
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) {
      const dd = m[1].padStart(2, "0")
      const mm = m[2].padStart(2, "0")
      const yyyy = m[3]
      return `${yyyy}-${mm}-${dd}`
    }
    return s
  }

  type CheckRow = CheckEntry & { batchId: string; batchFileName: string; uploadedAt: string }

  const checkRows: CheckRow[] = batches.flatMap((b) =>
    b.checks.map((c) => ({
      ...c,
      paymentDate: normalizePaymentDateToISO(c.paymentDate),
      batchId: b.id,
      batchFileName: b.fileName,
      uploadedAt: b.uploadedAt,
    }))
  )

  const monthKey = (yyyyMmDd: string) => {
    const [y, m] = normalizePaymentDateToISO(yyyyMmDd).split("-")
    return `${y}-${m}`
  }

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-")
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "long",
    })
  }

  const checksByMonth = (() => {
    const map = new Map<string, { key: string; count: number; total: number }>()
    for (const c of checkRows) {
      // "Quedan por pagar" = cheques emitidos (sent) agrupados por fecha de pago
      if (c.status !== "sent") continue
      const key = monthKey(c.paymentDate)
      const prev = map.get(key) ?? { key, count: 0, total: 0 }
      prev.count += 1
      prev.total += c.amount
      map.set(key, prev)
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1))
  })()

  const sortedChecks = [...checkRows].sort((a, b) => {
    // newest payment date first, fallback upload time
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? 1 : -1
    return a.uploadedAt < b.uploadedAt ? 1 : -1
  })

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground text-balance">Historial</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Historial completo de todos los lotes y cheques subidos
            </p>

<div className="mt-4">
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="destructive" size="sm">
        Reiniciar historial
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>¿Reiniciar historial?</AlertDialogTitle>
        <AlertDialogDescription>
          Esta acción borrará todos los lotes y cheques guardados en el historial. No afecta lo ya emitido en el banco.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          onClick={async () => {
            try {
              await resetHistory()
            } catch (e) {
              alert("No se pudo reiniciar el historial.")
            }
          }}
        >
          Sí, reiniciar
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</div>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total de Lotes</p>
                <p className="text-lg font-semibold text-card-foreground">{batches.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle2 className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cheques Enviados</p>
                <p className="text-lg font-semibold text-card-foreground">{totalSent.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monto Enviado</p>
                <p className="text-lg font-semibold text-card-foreground">{formatCurrency(totalAmountSent)}</p>
              </div>
            </div>
          </div>

          {batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 py-16">
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">Sin historial</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Suba un lote para ver su historial de cheques
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Batches */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Lotes</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lote</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha de Subida</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Cheques</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batches.map((batch) => {
                        const sent = batch.checks.filter((c) => c.status === "sent").length
                        const pending = batch.checks.filter((c) => c.status === "pending").length
                        const allDone = sent === batch.checks.length

                        return (
                          <tr key={batch.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium text-card-foreground">{batch.fileName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(batch.uploadedAt)}</td>
                            <td className="px-4 py-3 text-center text-card-foreground">{batch.checks.length}</td>
                            <td className="px-4 py-3 text-right font-mono font-medium text-card-foreground">
                              {formatCurrency(batch.totalAmount)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {allDone ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Completo
                                </span>
                              ) : pending > 0 ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                                  <Clock className="h-3 w-3" />
                                  {pending} pendientes
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {sent}/{batch.checks.length} enviados
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* By month */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Cheques emitidos por mes de pago</h2>
                {checksByMonth.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                    Todavía no hay cheques emitidos.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mes</th>
                          <th className="px-4 py-3 text-center font-medium text-muted-foreground">Cheques</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {checksByMonth.map((m) => (
                          <tr key={m.key} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-card-foreground capitalize">
                              {monthLabel(m.key)}
                            </td>
                            <td className="px-4 py-3 text-center text-card-foreground">{m.count}</td>
                            <td className="px-4 py-3 text-right font-mono font-medium text-card-foreground">
                              {formatCurrency(m.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Checks detail */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Detalle de cheques</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha de pago</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Beneficiario</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">CUIT</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">Monto</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lote</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sortedChecks.map((c) => (
                        <tr key={`${c.batchId}-${c.id}`} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-card-foreground whitespace-nowrap">
                            {new Date(c.paymentDate + "T00:00:00").toLocaleDateString("es-AR", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-3 text-card-foreground">{c.payeeName}</td>
                          <td className="px-4 py-3 font-mono text-card-foreground">{c.cuitNumber}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-card-foreground">
                            {formatCurrency(c.amount)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{c.batchFileName}</td>
                          <td className="px-4 py-3 text-center">
                            {c.status === "sent" ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                <CheckCircle2 className="h-3 w-3" />
                                Enviado
                              </span>
                            ) : c.status === "failed" ? (
                              <span className="text-xs font-medium text-destructive">Falló</span>
                            ) : c.status === "processing" ? (
                              <span className="text-xs font-medium text-warning">Procesando</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pendiente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
