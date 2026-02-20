export interface CheckEntry {
  id: string
  payeeName: string
  cuitNumber: string
  amount: number
  paymentDate: string
  email: string
  status: "pending" | "processing" | "sent" | "failed"
  /** ISO string when the check was successfully emitted */
  sentAt?: string
  /** ISO string when the check was last updated (best-effort) */
  updatedAt?: string
}

export interface UploadedBatch {
  id: string
  fileName: string
  uploadedAt: string
  checks: CheckEntry[]
  totalAmount: number
}

export interface BankAutomationStep {
  action: "click" | "fill" | "wait"
  target: string
  value?: string
}
