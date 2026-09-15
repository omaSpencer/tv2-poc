type Props = {
  value: unknown;
  label?: string;
};

export function JsonBlock({ value, label }: Props) {
  return (
    <div className="stack">
      {label ? <p className="muted">{label}</p> : null}
      <pre className="json">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
