import { CrmScreen } from "@/app/crm/crm-screen"

export const dynamic = "force-dynamic"

export const metadata = { title: "Касса — Aura CRM" }

export default function Page() {
  return <CrmScreen screen="kassa" />
}
