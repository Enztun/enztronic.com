import { Badge, type BadgeTone } from "@/components/ui/badge";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void" | "overdue";

const statusTone: Record<InvoiceStatus, BadgeTone> = {
  draft: "neutral",
  sent: "info",
  paid: "success",
  void: "danger",
  overdue: "warning",
};

export interface InvoiceStatusBadgeProps {
  status: InvoiceStatus;
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps) {
  return <Badge tone={statusTone[status]}>{status}</Badge>;
}
