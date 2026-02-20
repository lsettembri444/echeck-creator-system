import { DollarSign, FileCheck, Clock, Send } from "lucide-react"
import type { CheckEntry } from "@/lib/types"

interface StatCardsProps {
  checks: CheckEntry[]
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)

export function StatCards({ checks }: StatCardsProps) {
  const totalAmount = checks.reduce((s, c) => s + c.amount, 0)
  const pending = checks.filter((c) => c.status === "pending").length
  const sent = checks.filter((c) => c.status === "sent").length

  const stats = [
    {
      label: "Monto Total",
      value: formatCurrency(totalAmount),
      icon: DollarSign,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      label: "Total Cheques",
      value: String(checks.length),
      icon: FileCheck,
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
      label: "Enviados",
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
