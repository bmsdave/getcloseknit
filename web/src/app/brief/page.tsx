import { BriefPage } from "@/components/brief/brief-page";

export const metadata = {
  title: "Decision brief",
  description: "A one-page summary of the areas you're weighing up: price against your limit, the journey and what's still to find out.",
  // A household's own brief (read from its link or this device): never listed once the site is public.
  robots: { index: false, follow: true },
};

export default function Page() {
  return <BriefPage />;
}
