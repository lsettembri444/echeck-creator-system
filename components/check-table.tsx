"use client"

import { useState } from "react"
import {
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  AlertCircle,
  Terminal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CheckEntry } from "@/lib/types"

interface CheckTableProps {
  checks: CheckEntry[]
  batchId: string
  onSendChecks: (checkIds: string[]) => void
  isSending: boolean
  automationLogs?: string[]
}

function StatusBadge({ status }: { status: CheckEntry["status"] }) {
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
      label: "Enviado",
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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount)

export function CheckTable({
  checks,
  batchId,
  onSendChecks,
  isSending,
  automationLogs,
}: CheckTableProps) {
  const [selectedChecks, setSelectedChecks] = useState<Set<string>>(new Set())
  const [showLogs, setShowLogs] = useState(false)

  const pendingChecks = checks.filter((c) => c.status === "pending")
  const selectedPending = checks.filter(
    (c) => selectedChecks.has(c.id) && c.status === "pending"
  )
  const allSent = checks.length > 0 && checks.every((c) => c.status === "sent")
  const hasResults = checks.some((c) => c.status === "sent" || c.status === "failed")

  const toggleAll = () => {
    if (selectedChecks.size === checks.length) {
      setSelectedChecks(new Set())
    } else {
      setSelectedChecks(new Set(checks.map((c) => c.id)))
    }
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedChecks)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedChecks(next)
  }

  const handleSend = () => {
    const ids =
      selectedPending.length > 0
        ? selectedPending.map((c) => c.id)
        : pendingChecks.map((c) => c.id)
    onSendChecks(ids)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {checks.length} cheque{checks.length !== 1 ? "s" : ""} en total
          </span>
          {pendingChecks.length > 0 && (
            <span className="text-xs text-warning font-medium">
              {pendingChecks.length} listos para enviar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {automationLogs && automationLogs.length > 0 && (
            <button
              onClick={() => setShowLogs(!showLogs)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors border",
                showLogs
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              Logs
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={isSending || pendingChecks.length === 0}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando al banco...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Enviar {selectedPending.length > 0 ? `(${selectedPending.length})` : `Todos (${pendingChecks.length})`}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Automation Logs Panel */}
      {showLogs && automationLogs && automationLogs.length > 0 && (
        <div className="rounded-lg border border-border bg-foreground/95 p-4 overflow-auto max-h-60">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="h-4 w-4 text-success" />
            <span className="text-xs font-medium text-success font-mono">
              Registro de automatizacion
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {automationLogs.map((log, i) => (
              <span
                key={i}
                className={cn(
                  "font-mono text-xs leading-5",
                  log.includes("ERROR")
                    ? "text-red-400"
                    : log.includes("exitoso") || log.includes("agregado") || log.includes("finalizado")
                      ? "text-green-400"
                      : "text-background/80"
                )}
              >
                <span className="text-muted-foreground/50 mr-2 select-none">{String(i + 1).padStart(2, "0")}</span>
                {log}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="w-12 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedChecks.size === checks.length && checks.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border"
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Beneficiario</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">CUIT</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Monto</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha de Pago</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {checks.map((check) => (
                <tr
                  key={check.id}
                  className={cn(
                    "transition-colors hover:bg-muted/30",
                    selectedChecks.has(check.id) && "bg-primary/5",
                    check.status === "failed" && "bg-destructive/5"
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedChecks.has(check.id)}
                      onChange={() => toggleOne(check.id)}
                      className="h-4 w-4 rounded border-border"
                      aria-label={`Seleccionar cheque de ${check.payeeName}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{check.payeeName}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground text-xs">
                    {check.cuitNumber || "--"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-foreground">
                    {formatCurrency(check.amount)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{check.paymentDate}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[180px]">
                    {check.email || "--"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={check.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          Total: <span className="font-mono font-semibold text-foreground">{formatCurrency(checks.reduce((s, c) => s + c.amount, 0))}</span>
        </span>
        {allSent && (
          <span className="text-xs font-medium text-success">Todos los cheques enviados exitosamente</span>
        )}
        {hasResults && !allSent && (
          <span className="text-xs text-muted-foreground">
            {checks.filter((c) => c.status === "sent").length} enviados,{" "}
            {checks.filter((c) => c.status === "failed").length} con error
          </span>
        )}
      </div>
    </div>
  )
}
