import { DollarSign, ArrowRightLeft, Clock, Send } from "lucide-react"
import type { TransferEntry } from "@/lib/transfer-types"

interface TransferStatCardsProps {
  transfers: TransferEntry[]
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

export function TransferStatCards({ transfers }: TransferStatCardsProps) {
  const totalAmount = transfers.reduce((s, t) => s + t.amount, 0)
  const pending = transfers.filter((t) => t.status === "pending").length
  const sent = transfers.filter((t) => t.status === "sent").length

  const stats = [
    {
      label: "Monto Total",
      value: formatCurrency(totalAmount),
      icon: DollarSign,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      label: "Total Transferencias",
      value: String(transfers.length),
      icon: ArrowRightLeft,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      label: "Pendientes",
      value: String(pending),
      icon: Clock,
      iconBg: "bg-warning/10",
      iconColor: "text-warning",
    },
    {
      label: "Enviadas",
      value: String(sent),
      icon: Send,
      iconBg: "bg-success/10",
      iconColor: "text-success",
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.iconBg}`}>
            <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-lg font-semibold text-card-foreground">{stat.value}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
