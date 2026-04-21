import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const role    = session?.user?.role

  if (role !== "ADMIN" && role !== "APPROVER") {
    redirect("/")
  }

  return <>{children}</>
}
