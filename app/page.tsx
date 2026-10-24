import { getAllGuides } from "@/lib/guides";
import { GuideCard } from "@/components/GuideCard";
import { LibraryBrowser } from "@/components/LibraryBrowser";

// The gallery changes whenever the agent publishes a guide, so render it per request.
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const guides = await getAllGuides();
  return (
    <>
      <h1>Guide library</h1>
      <LibraryBrowser items={guides.map((g) => ({ slug: g.slug, name: g.app.name, card: <GuideCard guide={g} /> }))} />
      {guides.length === 0 && <p>No guides yet.</p>}
    </>
  );
}
