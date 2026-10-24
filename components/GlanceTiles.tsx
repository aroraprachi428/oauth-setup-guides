import { Icon } from "./Icon";

export type Glance = {
  cost: "paid" | "free" | "unknown";
  blockers: string[];
  reported?: string;
};

const COST_TEXT = {
  paid: "Paid step involved",
  free: "Free",
  unknown: "No cost mentioned",
} as const;

// One line of facts under the title: what it costs and who can stop you.
export function GlanceTiles({ glance }: { glance: Glance }) {
  return (
    <dl className="glance">
      <div>
        <dt>
          <Icon name="cost" /> Cost
        </dt>
        <dd>{COST_TEXT[glance.cost]}</dd>
      </div>
      <div>
        <dt>
          <Icon name="shield" /> Can block you
        </dt>
        <dd>{glance.blockers.join(", ") || "Nobody documented"}</dd>
      </div>
      {glance.reported && (
        <div>
          <dt>
            <Icon name="clock" /> Readers report
          </dt>
          <dd>{glance.reported}</dd>
        </div>
      )}
    </dl>
  );
}

// What's true once you're live: the caps to plan for and the top risks.
export function LiveSummary({ limits, risks }: { limits: { what: string; value: string }[]; risks: string[] }) {
  return (
    <div className="live">
      {limits.length > 0 && (
        <dl className="facts-list">
          {limits.map((l, i) => (
            <div key={`${i}-${l.what}`} className="facts-list__row">
              <dt>{l.what}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {risks.length > 0 && (
        <ul className="risks">
          {risks.map((r) => (
            <li key={r}>
              <Icon name="alert" /> <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
