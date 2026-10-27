import { connection } from "next/server";

import { SaveListingPage } from "@/components/save-listing-page";
import { serverDefaults } from "@/lib/deployment";

export const metadata = {
  title: "Save a home",
  description: "Keep a listing you found on a portal beside its area's evidence, on this device only.",
  robots: { index: false, follow: true },
};

export default async function Page() {
  await connection();
  // The area call names its metric and month: without them the API answers 422.
  const period = (await serverDefaults()).served?.defaultPeriod ?? null;
  return <SaveListingPage period={period} />;
}
