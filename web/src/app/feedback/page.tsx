import { FeedbackForm } from "@/components/feedback-form";
import { SiteHeader } from "@/components/site-header";
import { SubpageHero } from "@/components/subpage-hero";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Feedback",
  description: "Tell us how Close Knit is working for you: a rating, what helped or got in the way, and a few words.",
  path: "/feedback",
});

export default function FeedbackPage() {
  return (
    <main className="subpage" data-testid="feedback-page">
      <SiteHeader />
      <SubpageHero
        eyebrow="Feedback"
        title="How's Close Knit so far?"
        ornament="town"
        yarn="var(--yarn-sun)"
      />
      <div className="subpage-cards">
        <section className="subpage-card" aria-label="Your feedback">
          <FeedbackForm showTitle={false} />
        </section>
      </div>
    </main>
  );
}
