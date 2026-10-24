import type { Metadata } from "next";
import { AddProgress } from "@/components/AddProgress";

export const metadata: Metadata = { title: "Adding an app", robots: { index: false } };

export default async function AddPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <AddProgress jobId={jobId} />;
}
