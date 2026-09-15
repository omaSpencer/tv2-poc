type Props = {
  milestone: string;
  feature: string;
  detail?: string;
};

export function MilestoneGate({ milestone, feature, detail }: Props) {
  return (
    <aside className="milestone-gate" role="note">
      <strong>Backend {milestone}</strong>
      <span>
        {feature} még nem elérhető, vagy a függőség ki van kapcsolva. A UI készen áll; a hívás
        problem+json / 503 válaszát a panel mutatja.
      </span>
      {detail ? <span className="muted">{detail}</span> : null}
    </aside>
  );
}
