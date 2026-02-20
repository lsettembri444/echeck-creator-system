export interface TransferEntry {
  id: string
  providerName: string
  cuitNumber: string
  cbu: string
  amount: number
  paymentDate: string
  status: "pending" | "processing" | "sent" | "failed"
  /** ISO string when the transfer was successfully sent */
  sentAt?: string
  /** ISO string when the transfer was last updated */
  updatedAt?: string
}

export interface TransferBatch {
  id: string
  fileName: string
  uploadedAt: string
  transfers: TransferEntry[]
  totalAmount: number
}
