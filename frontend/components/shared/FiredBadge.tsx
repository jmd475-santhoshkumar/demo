import { Badge } from "@/components/shared/Badge";

export function FiredBadge({ fired }: { fired: boolean }) {
  return fired ? <Badge variant="red">Flagged</Badge> : <Badge variant="default">OK</Badge>;
}
