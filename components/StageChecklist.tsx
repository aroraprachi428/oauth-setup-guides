"use client";

import { useState } from "react";
import { ReportProblem } from "./ReportProblem";
import { InstructionList, Rich, splitHeadline } from "./RichText";
import { Icon } from "./Icon";
import { useChecks } from "./useChecks";

export type StepView = {
  id: string;
  title: string;
  who: string;
  owner: "agent" | "developer" | "provider";
  // Set when a person has to do something an agent can't, e.g. "2FA".
  humanGate?: string;
  agentCanDo: boolean;
  estimateMinutes?: number;
  instructions: string[];
  links: { label: string; url: string }[];
  uiLabelsMayBeStale?: boolean;
  // Warnings and quirks tied to this step.
  headsUp: string[];
  troubleshooting: { symptom: string; cause: string; fix: string }[];
};

// Step rows: title only until opened; one step open at a time.
export function StageChecklist({ steps, slug, storageKey }: { steps: StepView[]; slug: string; storageKey: string }) {
  const { done, toggle } = useChecks(storageKey);
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  return (
    <ul className="rows plain">
      {steps.map((s) => {
        const ticked = done.includes(s.id);
        const isOpen = open === s.id;
        return (
          <li key={s.id} className={`row${ticked ? " row--done" : ""}${isOpen ? " row--open" : ""}`}>
            <div className="row__head">
              <input type="checkbox" className="row__check" checked={ticked} onChange={() => toggle(s.id)} aria-label={`Done: ${s.title}`} />
              <button
                type="button"
                className="row__toggle"
                aria-expanded={isOpen}
                aria-controls={`step-${s.id}`}
                onClick={() => {
                  setOpen(isOpen ? null : s.id);
                  setFull(false);
                }}
              >
                <span className="row__title">{s.title}</span>
                <span className="row__meta">
                  {s.headsUp.length > 0 && (
                    <span className="row__hint row__hint--warn" title={splitHeadline(s.headsUp[0])[0]}>
                      <Icon name="alert" label={`Heads-up: ${splitHeadline(s.headsUp[0])[0]}`} />
                    </span>
                  )}
                  {s.humanGate && (
                    <span className="row__hint" title={`Needs you: ${s.humanGate}`}>
                      <Icon name="user" label={`Needs you: ${s.humanGate}`} />
                    </span>
                  )}
                  {s.agentCanDo && (
                    <span className="row__hint" title="An agent can do this">
                      <Icon name="agent" label="An agent can do this" />
                    </span>
                  )}
                  {s.estimateMinutes && <span>~{s.estimateMinutes} min</span>}
                  <span className="row__chevron" aria-hidden="true" />
                </span>
              </button>
            </div>

            {isOpen && (
              <div className="row__body" id={`step-${s.id}`}>
                <InstructionList lines={s.instructions} brief={!full} />
                {s.headsUp.map((g) => (
                  <p key={g} className="heads-up">
                    <Icon name="alert" /> <span><Rich text={full ? g : splitHeadline(g)[0]} /></span>
                  </p>
                ))}
                {full && s.troubleshooting.length > 0 && (
                  <dl className="trouble">
                    {s.troubleshooting.map((t) => (
                      <div key={t.symptom}>
                        <dt>
                          <Rich text={t.symptom} />
                        </dt>
                        <dd>
                          <Rich text={t.fix} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="row__links">
                  {s.links.map((l) => (
                    <a key={l.url} href={l.url} rel="noreferrer" target="_blank">
                      {l.label} <Icon name="external" />
                    </a>
                  ))}
                  <button type="button" className="link-button" aria-expanded={full} onClick={() => setFull(!full)}>
                    {full ? "Less detail" : "More detail"}
                  </button>
                </p>
                {full && s.uiLabelsMayBeStale && <p className="muted">Menu names in the console may have changed.</p>}
                <ReportProblem slug={slug} target={s.id} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// A single tickable line, used for the checkpoint.
export function CheckItem({ id, storageKey, children }: { id: string; storageKey: string; children: React.ReactNode }) {
  const { done, toggle } = useChecks(storageKey);
  return (
    <label className="check-item">
      <input type="checkbox" className="row__check" checked={done.includes(id)} onChange={() => toggle(id)} />
      <span>{children}</span>
    </label>
  );
}
