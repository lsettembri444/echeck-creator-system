"use client"

import {
  FileSpreadsheet,
  LayoutDashboard,
  History,
  Shield,
  ArrowRightLeft,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Panel", href: "/", icon: LayoutDashboard },
  { label: "Subir Lote", href: "/upload", icon: FileSpreadsheet },
  { label: "Historial Cheques", href: "/history", icon: History },
  { label: "Transferencias", href: "/transfers", icon: ArrowRightLeft },
  { label: "Historial Transf.", href: "/transfers/history", icon: History },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <Shield className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-sidebar-primary-foreground">eCheque Creator by Lemmon</h1>
          <p className="text-xs text-sidebar-foreground/60"></p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="flex flex-col gap-1" role="list">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-4">
        <p className="text-xs text-sidebar-foreground/50 leading-relaxed">
          Las operaciones requieren un codigo de confirmacion antes de ser ejecutadas en el banco.
        </p>
      </div>
    </aside>
  )
}
