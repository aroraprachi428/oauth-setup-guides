"use client";

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { useChecks } from "./useChecks";

export type Station = {
  id: string;
  title: string;
  // Shown beside the title, e.g. the stage band.
  meta?: ReactNode;
  // Checklist ids that must all be ticked for this station to count as passed.
  doneWhen: string[];
  // Ids counted in the "x of y" progress line; omit for single-check stations.
  progressIds?: string[];
  content: ReactNode;
};

// The guide as one transit line: passed stations are filled, the current one is highlighted.
export function GuideFlow({ stations, storageKey }: { stations: Station[]; storageKey: string }) {
  const { done } = useChecks(storageKey);
  const passed = stations.map((s) => s.doneWhen.length > 0 && s.doneWhen.every((id) => done.includes(id)));
  const current = passed.indexOf(false);

  return (
    <ol className="line plain">
      {stations.map((s, i) => {
        const state = passed[i] ? "done" : i === current ? "current" : "todo";
        const count = s.progressIds?.filter((id) => done.includes(id)).length ?? 0;
        return (
          <li key={s.id} className={`station station--${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="station__dot" aria-hidden="true">
              {state === "done" && <Icon name="check" />}
            </span>
            <div className="station__body">
              <h2 className="station__title" id={`station-${s.id}`}>
                {s.title}
                {s.meta && <span className="station__meta">{s.meta}</span>}
              </h2>
              {s.progressIds && s.progressIds.length > 0 && (
                <p className="station__progress">
                  <span className="sr-only">{state === "done" ? "Done. " : ""}</span>
                  {count} of {s.progressIds.length} steps done
                </p>
              )}
              {s.content}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
