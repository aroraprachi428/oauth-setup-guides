import Link from "next/link";
import type { Guide } from "@/lib/schema";

export function GuideCard({ guide }: { guide: Guide }) {
  return (
    <article className="card">
      <h2 className="card__title">
        <Link href={`/guides/${guide.slug}`} className="card__link">
          {guide.app.name}
        </Link>
      </h2>
      {guide.source === "generated" && <span className="ai-label">AI-generated</span>}
    </article>
  );
}
