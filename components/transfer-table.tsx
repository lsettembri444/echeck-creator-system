"use client"

import { useMemo, useRef, useEffect } from "react"
import {
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  AlertCircle,
  Terminal,
  CalendarDays,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { TransferEntry } from "@/lib/transfer-types"

interface TransferTableProps {
  transfers: TransferEntry[]
  batchId: string
  /** Called when the user clicks "Enviar" on a specific date group */
  onSendDateGroup: (date: string, transferIds: string[]) => void
  /** The date group currently being sent (null if idle) */
  sendingDate: string | null
  automationLogs?: string[]
}

/** Group info for a single date */
interface DateGroup {
  date: string
  transfers: TransferEntry[]
  totalAmount: number
  pendingCount: number
  sentCount: number
  failedCount: number
  processingCount: number
}

function StatusBadge({ status }: { status: TransferEntry["status"] }) {
  const config = {
    pending: {
      label: "Pendiente",
      className: "bg-warning/15 text-warning border-warning/20",
      icon: Clock,
    },
    processing: {
      label: "Procesando",
      className: "bg-muted text-muted-foreground border-border",
      icon: Loader2,
    },
    sent: {
      label: "Enviada",
      className: "bg-success/15 text-success border-success/20",
      icon: CheckCircle2,
    },
    failed: {
      label: "Error",
      className: "bg-destructive/10 text-destructive border-destructive/20",
      icon: AlertCircle,
    },
  }

  const { label, className, icon: Icon } = config[status]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
        className
      )}
    >
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} />
      {label}
    </span>
  )
}

function DateGroupStatusBadge({ group }: { group: DateGroup }) {
  if (group.processingCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Procesando
      </span>
    )
  }
  if (group.sentCount === group.transfers.length) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-success/20 bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="h-3 w-3" />
        Enviado
      </span>
    )
  }
  if (group.failedCount > 0 && group.pendingCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    )
  }
  return null
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)

function groupByDate(transfers: TransferEntry[]): DateGroup[] {
  const map = new Map<string, TransferEntry[]>()
  for (const t of transfers) {
    const date = t.paymentDate || "Sin fecha"
    if (!map.has(date)) map.set(date, [])
    map.get(date)!.push(t)
  }

  const groups: DateGroup[] = []
  for (const [date, items] of map.entries()) {
    groups.push({
      date,
      transfers: items,
      totalAmount: items.reduce((s, t) => s + t.amount, 0),
      pendingCount: items.filter((t) => t.status === "pending").length,
      sentCount: items.filter((t) => t.status === "sent").length,
      failedCount: items.filter((t) => t.status === "failed").length,
      processingCount: items.filter((t) => t.status === "processing").length,
    })
  }

  // Sort by date (DD/MM/YYYY) -- earliest first
  groups.sort((a, b) => {
    const pa = a.date.split("/")
    const pb = b.date.split("/")
    const da = pa.length === 3 ? new Date(+pa[2], +pa[1] - 1, +pa[0]).getTime() : 0
    const db = pb.length === 3 ? new Date(+pb[2], +pb[1] - 1, +pb[0]).getTime() : 0
    return da - db
  })

  return groups
}

export function TransferTable({
  transfers,
  batchId,
  onSendDateGroup,
  sendingDate,
  automationLogs,
}: TransferTableProps) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  const dateGroups = useMemo(() => groupByDate(transfers), [transfers])
  const isSending = sendingDate !== null

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current && logsContainerRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [automationLogs])

  const totalAll = transfers.reduce((s, t) => s + t.amount, 0)
  const allSent = transfers.length > 0 && transfers.every((t) => t.status === "sent")
  const totalSentCount = transfers.filter((t) => t.status === "sent").length
  const totalFailedCount = transfers.filter((t) => t.status === "failed").length
  const totalPendingCount = transfers.filter((t) => t.status === "pending").length

  return (
    <div className="flex flex-col gap-5">
      {/* Summary bar */}
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3 border border-border">
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {transfers.length} transferencia{transfers.length !== 1 ? "s" : ""}
            {" en "}
            <span className="font-medium text-foreground">{dateGroups.length} fecha{dateGroups.length !== 1 ? "s" : ""}</span>
          </span>
          <span className="text-sm text-muted-foreground">
            Total: <span className="font-mono font-semibold text-foreground">{formatCurrency(totalAll)}</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {totalPendingCount > 0 && (
            <span className="text-xs text-warning font-medium">
              {totalPendingCount} pendiente{totalPendingCount !== 1 ? "s" : ""}
            </span>
          )}
          {allSent && (
            <span className="text-xs font-medium text-success">
              Todas enviadas
            </span>
          )}
          {totalSentCount > 0 && !allSent && (
            <span className="text-xs text-muted-foreground">
              {totalSentCount} enviada{totalSentCount !== 1 ? "s" : ""}
              {totalFailedCount > 0 && `, ${totalFailedCount} con error`}
            </span>
          )}
        </div>
      </div>

      {/* Info: bank limitation */}
      {dateGroups.length > 1 && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Nota:</span>{" "}
            El banco solo permite una fecha de envio por lote. Las transferencias se agrupan por fecha
            y se envian en lotes separados. Cada lote requiere un codigo de seguridad individual.
          </p>
        </div>
      )}

      {/* Results Checklist -- shown when there are sent/failed transfers */}
      {(totalSentCount > 0 || totalFailedCount > 0) && !isSending && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-medium text-foreground">
                Resultado de transferencias
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {totalSentCount} exitosa{totalSentCount !== 1 ? "s" : ""}
              {totalFailedCount > 0 && (
                <span className="text-destructive ml-1">
                  / {totalFailedCount} con error
                </span>
              )}
            </span>
          </div>
          <div className="divide-y divide-border">
            {transfers
              .filter((t) => t.status === "sent" || t.status === "failed")
              .map((transfer) => (
                <div
                  key={transfer.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5",
                    transfer.status === "failed" && "bg-destructive/5"
                  )}
                >
                  {transfer.status === "sent" ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground">
                      {transfer.providerName}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {transfer.cbu}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-medium text-foreground shrink-0">
                    {formatCurrency(transfer.amount)}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium shrink-0",
                      transfer.status === "sent" ? "text-success" : "text-destructive"
                    )}
                  >
                    {transfer.status === "sent" ? "Enviada" : "Error"}
                  </span>
                </div>
              ))}
          </div>
          {totalSentCount > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-success/5">
              <span className="text-xs font-medium text-success">Total enviado</span>
              <span className="font-mono text-sm font-semibold text-success">
                {formatCurrency(
                  transfers
                    .filter((t) => t.status === "sent")
                    .reduce((s, t) => s + t.amount, 0)
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Automation Logs Panel */}
      {(isSending || (automationLogs && automationLogs.length > 0)) && (
        <div
          ref={logsContainerRef}
          className="rounded-lg border border-border bg-foreground/95 p-4 overflow-auto max-h-72"
        >
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="h-4 w-4 text-success" />
            <span className="text-xs font-medium text-success font-mono">
              Registro de automatizacion
              {sendingDate && (
                <span className="text-success/70 ml-2">-- Fecha: {sendingDate}</span>
              )}
            </span>
            {isSending && (
              <Loader2 className="h-3 w-3 animate-spin text-success ml-auto" />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {(!automationLogs || automationLogs.length === 0) && isSending && (
              <span className="font-mono text-xs leading-5 text-background/50">
                Iniciando automatizacion...
              </span>
            )}
            {automationLogs?.map((log, i) => (
              <span
                key={i}
                className={cn(
                  "font-mono text-xs leading-5",
                  log.includes("ERROR")
                    ? "text-red-400"
                    : log.includes("[WARN]")
                      ? "text-yellow-400"
                      : log.includes("exitoso") || log.includes("completada") || log.includes("finalizado") || log.includes("confirmada")
                        ? "text-green-400"
                        : log.startsWith("[debug]") || log.startsWith("  [debug]")
                          ? "text-blue-300/70"
                          : "text-background/80"
                )}
              >
                <span className="text-muted-foreground/50 mr-2 select-none">
                  {String(i + 1).padStart(3, "0")}
                </span>
                {log}
              </span>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Date-grouped sections */}
      {dateGroups.map((group) => {
        const isGroupSending = sendingDate === group.date
        const isGroupDone = group.sentCount === group.transfers.length
        const hasPending = group.pendingCount > 0
        const canSend = hasPending && !isSending

        return (
          <div
            key={group.date}
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              isGroupSending
                ? "border-primary/40 ring-1 ring-primary/20"
                : isGroupDone
                  ? "border-success/30"
                  : "border-border"
            )}
          >
            {/* Date group header */}
            <div
              className={cn(
                "flex items-center justify-between px-4 py-3 border-b",
                isGroupDone
                  ? "bg-success/5 border-success/20"
                  : isGroupSending
                    ? "bg-primary/5 border-primary/20"
                    : "bg-muted/50 border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex items-center justify-center h-8 w-8 rounded-md",
                    isGroupDone
                      ? "bg-success/10 text-success"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  <CalendarDays className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">{group.date}</span>
                    <DateGroupStatusBadge group={group} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {group.transfers.length} transferencia{group.transfers.length !== 1 ? "s" : ""}
                    {" -- "}
                    <span className="font-mono font-medium">{formatCurrency(group.totalAmount)}</span>
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  const pendingIds = group.transfers
                    .filter((t) => t.status === "pending")
                    .map((t) => t.id)
                  onSendDateGroup(group.date, pendingIds)
                }}
                disabled={!canSend}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  canSend
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : isGroupDone
                      ? "bg-success/10 text-success border border-success/20 cursor-default"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  isGroupSending && "bg-primary/80"
                )}
              >
                {isGroupSending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : isGroupDone ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Enviado
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar lote ({group.pendingCount})
                  </>
                )}
              </button>
            </div>

            {/* Transfer rows */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Proveedor</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">CUIT</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">CBU</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs">Monto</th>
                    <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {group.transfers.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className={cn(
                        "transition-colors hover:bg-muted/20",
                        transfer.status === "failed" && "bg-destructive/5"
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-foreground text-sm">{transfer.providerName}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">
                        {transfer.cuitNumber || "--"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">
                        {transfer.cbu || "--"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium text-foreground text-sm">
                        {formatCurrency(transfer.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge status={transfer.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
