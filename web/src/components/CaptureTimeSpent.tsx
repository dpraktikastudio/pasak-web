import {
  buildReportRows,
  formatTimingSeconds,
  type CaptureTimingReport,
} from "../lib/captureTiming";

type Props = {
  report: CaptureTimingReport;
};

export function CaptureTimeSpent({ report }: Props) {
  const rows = buildReportRows(report);

  return (
    <details className="time-spent">
      <summary className="time-spent__summary">
        <span className="time-spent__summary-title">Time spent</span>
        <span className="time-spent__value">{formatTimingSeconds(report.totalMs)}</span>
      </summary>
      <ul className="time-spent__list">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`time-spent__row${row.id === "total" ? " time-spent__row--total" : ""}`}
          >
            <span className="time-spent__label">{row.label}</span>
            <span className="time-spent__value">{formatTimingSeconds(row.durationMs)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
