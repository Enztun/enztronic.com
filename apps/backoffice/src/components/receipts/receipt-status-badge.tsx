import { Badge, type BadgeTone } from "@/components/ui/badge";

export type ReceiptStatus = "needs_review" | "recorded" | "undone" | "discarded";

const labels: Record<ReceiptStatus, { label: string; tone: BadgeTone }> = {
  needs_review: { label: "Needs review", tone: "warning" },
  recorded: { label: "Recorded", tone: "success" },
  undone: { label: "Undone", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
};

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const { label, tone } = labels[status];
  return <Badge tone={tone}>{label}</Badge>;
}
