import { redirect } from "next/navigation";

// The sidebar's "RMG" entry is now a hover/click flyout (Resourcing/Budget),
// not a link to a landing page -- so there's no page of its own to show
// here. This only exists for anyone who deep-links or bookmarks the bare
// /resourcing URL; it sends them straight to the deal list rather than a
// 404 or a now-pointless hub page.
export default function ResourcingRedirectPage() {
  redirect("/resourcing/deals");
}
