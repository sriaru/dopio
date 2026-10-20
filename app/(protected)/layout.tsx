import { requireWorkspace } from "@/lib/auth/session";
// AI requests and reviewed Google sync need more than a short function timeout.
export const maxDuration = 300;
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireWorkspace();
  return children;
}
