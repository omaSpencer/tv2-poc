import { formatTimestamp } from '../format';

export function TimestampValue({ value }: { value: string | null }) {
  if (value === null) return <>nincs adat</>;
  return <time dateTime={value} title={value}>{formatTimestamp(value)}</time>;
}
