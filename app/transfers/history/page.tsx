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
import { ArrowRightLeft, CheckCircle2, Clock, DollarSign } from "lucide-react"
import type { TransferBatch, TransferEntry } from "@/lib/transfer-types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)

export default function TransferHistoryPage() {
  const { data: batches = [], mutate } = useSWR<TransferBatch[]>("/api/transfers", fetcher)

  const resetHistory = async () => {
    const res = await fetch("/api/transfers/reset", { method: "POST" })
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

  const allTransfers = batches.flatMap((b) => b.transfers)
  const totalSent = allTransfers.filter((t) => t.status === "sent")
  const totalAmountSent = totalSent.reduce((s, t) => s + t.amount, 0)

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

  type TransferRow = TransferEntry & { batchId: string; batchFileName: string; uploadedAt: string }

  const transferRows: TransferRow[] = batches.flatMap((b) =>
    b.transfers.map((t) => ({
      ...t,
      paymentDate: normalizePaymentDateToISO(t.paymentDate),
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

  const transfersByMonth = (() => {
    const map = new Map<string, { key: string; count: number; total: number }>()
    for (const t of transferRows) {
      if (t.status !== "sent") continue
      const key = monthKey(t.paymentDate)
      const prev = map.get(key) ?? { key, count: 0, total: 0 }
      prev.count += 1
      prev.total += t.amount
      map.set(key, prev)
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1))
  })()

  const sortedTransfers = [...transferRows].sort((a, b) => {
    if (a.paymentDate !== b.paymentDate) return a.paymentDate < b.paymentDate ? 1 : -1
    return a.uploadedAt < b.uploadedAt ? 1 : -1
  })

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground text-balance">Historial de Transferencias</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Historial completo de todos los lotes y transferencias enviadas
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
                    <AlertDialogTitle>{"Reiniciar historial?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta accion borrara todos los lotes y transferencias guardados en el historial. No afecta lo ya ejecutado en el banco.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        try {
                          await resetHistory()
                        } catch {
                          alert("No se pudo reiniciar el historial.")
                        }
                      }}
                    >
                      Si, reiniciar
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
                <ArrowRightLeft className="h-4 w-4 text-primary" />
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
                <p className="text-xs text-muted-foreground">Transferencias Enviadas</p>
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
              <ArrowRightLeft className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">Sin historial</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Suba un lote para ver su historial de transferencias
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Batches */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Lotes</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lote</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha de Subida</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Transferencias</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {batches.map((batch) => {
                        const sent = batch.transfers.filter((t) => t.status === "sent").length
                        const pending = batch.transfers.filter((t) => t.status === "pending").length
                        const allDone = sent === batch.transfers.length

                        return (
                          <tr key={batch.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium text-card-foreground">{batch.fileName}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(batch.uploadedAt)}</td>
                            <td className="px-4 py-3 text-center text-card-foreground">{batch.transfers.length}</td>
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
                                  {sent}/{batch.transfers.length} enviadas
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
                <h2 className="text-sm font-semibold text-foreground mb-3">Transferencias enviadas por mes de pago</h2>
                {transfersByMonth.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                    Todavia no hay transferencias enviadas.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mes</th>
                          <th className="px-4 py-3 text-center font-medium text-muted-foreground">Transferencias</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {transfersByMonth.map((m) => (
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

              {/* Detail */}
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3">Detalle de transferencias</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha de pago</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Proveedor</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">CUIT</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">CBU</th>
                        <th className="px-4 py-3 text-right font-medium text-muted-foreground">Monto</th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">Lote</th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sortedTransfers.map((t) => (
                        <tr key={`${t.batchId}-${t.id}`} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-card-foreground whitespace-nowrap">
                            {new Date(t.paymentDate + "T00:00:00").toLocaleDateString("es-AR", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-3 text-card-foreground">{t.providerName}</td>
                          <td className="px-4 py-3 font-mono text-card-foreground text-xs">{t.cuitNumber}</td>
                          <td className="px-4 py-3 font-mono text-card-foreground text-xs">{t.cbu}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium text-card-foreground">
                            {formatCurrency(t.amount)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{t.batchFileName}</td>
                          <td className="px-4 py-3 text-center">
                            {t.status === "sent" ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                <CheckCircle2 className="h-3 w-3" />
                                Enviada
                              </span>
                            ) : t.status === "failed" ? (
                              <span className="text-xs font-medium text-destructive">Fallo</span>
                            ) : t.status === "processing" ? (
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
