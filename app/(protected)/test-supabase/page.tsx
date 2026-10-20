import { redirect } from "next/navigation";
export default function LegacyDatabasePage() {
  redirect("/?view=Artists");
}
