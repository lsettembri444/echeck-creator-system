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

export interface TransferOperationLog {
  id: string
  batchId: string
  batchDate: string
  executedAt: string
  totalSent: number
  totalFailed: number
  totalAmount: number
  bankOperationId?: string
  transfers: {
    providerName: string
    cbu: string
    amount: number
    success: boolean
    error?: string
  }[]
}
