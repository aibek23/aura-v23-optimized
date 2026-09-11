import { redirect } from "next/navigation"

// CRM теперь разложена по отдельным URL — главный экран это касса (/crm/pos).
export default function CrmIndexPage() {
  redirect("/crm/pos")
}
