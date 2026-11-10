import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

/** Vision and assistant providers now live on one page: /admin/ai. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/admin/ai", locale });
}
