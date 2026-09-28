import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SplineAreaChartComponent } from './shared/charts/spline-area-chart/spline-area-chart.component';
import { ChartOptions } from './models/chart-options.model';

type Unit = 'Auto' | 'KB' | 'MB' | 'GB';
type ResolvedUnit = 'KB' | 'MB' | 'GB';
type Interval = '5s' | '15s' | '30s' | '5m' | '15m' | '30m' | '1h' | '1d' | '1w' | '1mo';

interface NodeResponse {
  id: string;
  nodeId: string;
  url: string;
  enabled: boolean;
  availableDiskSpace: number | null;
  usedDiskSpace: number | null;
  totalDiskSpace: number | null;
  color: string | null;
  currentMonthPayout: number | null;
  previousMonthPayout: number | null;
  currentMonthExpectations: number | null;
}

interface NodeCard {
  name: string;
  id: string;
  url: string;
  status: string;
  availableDiskSpace: number | null;
  usedDiskSpace: number | null;
  totalDiskSpace: number | null;
  color: string;
  currentMonthPayout: number | null;
  previousMonthPayout: number | null;
  currentMonthExpectations: number | null;
}

interface OverviewPoint {
  label: string;
  storageUsed: number | null;
  storagePercentOfFirst: number | null;
  trashUsed: number | null;
  trashPercentOfFirst: number | null;
  ingressTotal: number | null;
  egressTotal: number | null;
  totalBandwidthUsed: number | null;
  uptimePercent: number | null;
  estimatedPayout: number | null;
  currentMonthPayout: number | null;
}

interface OverviewResponse {
  interval: Interval;
  points: number;
  data: OverviewPoint[];
}

const RANGE_OPTIONS = [10, 20, 30, 60, 90] as const;
type Range = typeof RANGE_OPTIONS[number];
type ChartKey = 'storage' | 'trash' | 'bandwidth' | 'uptime' | 'payout';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [CommonModule, FormsModule, SplineAreaChartComponent]
})
export class AppComponent implements OnDestroy {
  public activeView = 'Overview';
  public lastSync = new Date();
  public toastMessage = '';
  public storageUnit: Unit = 'Auto';
  public trashUnit: Unit = 'Auto';
  public bandwidthUnit: Unit = 'Auto';
  public dateFilterStart: string = '';
  public dateFilterEnd: string = '';
  public readonly rangeOptions = RANGE_OPTIONS;
  public globalInterval: Interval = '5m';
  public get storageInterval(): Interval { return this.globalInterval; }
  public get trashInterval(): Interval { return this.globalInterval; }
  public get bandwidthInterval(): Interval { return this.globalInterval; }
  public uptimeInterval: Interval = '30m';
  public storageRange: Range = 30;
  public trashRange: Range = 30;
  public bandwidthRange: Range = 30;
  public uptimeRange: Range = 30;
  private readonly overviewData = new Map<string, OverviewResponse>();
  public storageSummary = '';
  public storageDeltaText = '';
  public trashSummary = '';
  public trashDeltaText = '';
  public bandwidthSummary = '';
  public bandwidthIngressTotal = '';
  public bandwidthEgressTotal = '';
  public bandwidthIngressDeltaText = '';
  public bandwidthEgressDeltaText = '';
  public uptimeSummary = '';
  public uptimeDeltaText = '';
  public storageChart = this.createChart('#c7f36b', 'Storage used');
  public trashChart = this.createChart('#f4bb61', 'Trash');
  public bandwidthChart = { ...this.createChart('#5bd6e8', 'Bandwidth'), colors: ['#34d399', '#fb7185'] }; // Ingress (in) / Egress (out)
  public payoutChart = this.createChart('#1dd1a1', 'Valor a receber');
  public uptimeChart = this.createChart('#83a9ff', 'Uptime %');
  public nodes: NodeCard[] = [];
  public payoutSummary = '';
  public payoutDeltaText = '';
  public currentPayoutSummary = '';
  public currentPayoutDeltaText = '';
  public payoutInterval: Interval = '30m';
  public payoutRange: Range = 30;
  public payoutUnit: Unit = 'Auto';

  public readonly jobs = [
    { label: 'SNO 5m', cadence: 'Every 5 minutes', state: 'Scheduled' },
    { label: 'SNO 15m', cadence: 'Every 15 minutes', state: 'Scheduled' },
    { label: 'SNO 30m', cadence: 'Every 30 minutes', state: 'Scheduled' },
    { label: 'SNO hour', cadence: 'Hourly', state: 'Scheduled' },
    { label: 'SNO day', cadence: 'Daily', state: 'Scheduled' },
    { label: 'SNO week', cadence: 'Weekly', state: 'Scheduled' },
    { label: 'SNO month', cadence: 'Monthly', state: 'Scheduled' }
  ];

  private readonly chartKeys: readonly ChartKey[] = ['bandwidth', 'storage', 'payout', 'trash', 'uptime'];
  private sharedTimer?: ReturnType<typeof setInterval>;
  private uptimeTimer?: ReturnType<typeof setInterval>;
  private bandwidth24hTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly http: HttpClient) {
    this.loadNodes();
    this.loadOverview();
    this.scheduleSharedAutoRefresh();
    this.scheduleUptimeAutoRefresh();
    this.loadBandwidth24hSummary();
    this.bandwidth24hTimer = setInterval(() => this.loadBandwidth24hSummary(), 300_000);
  }

  ngOnDestroy(): void {
    if (this.sharedTimer) clearInterval(this.sharedTimer);
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    if (this.bandwidth24hTimer) clearInterval(this.bandwidth24hTimer);
  }

  public selectPayoutInterval(interval: Interval): void {
    this.payoutInterval = interval;
    this.fetchOverview('payout', true);
  }

  private refreshMsFor(interval: Interval): number {
    const cadence: Record<Interval, number> = {
      '5s': 5_000, '15s': 15_000, '30s': 30_000,
      '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
      '1h': 3_600_000, '1d': 60_000, '1w': 60_000, '1mo': 60_000
    };
    return cadence[interval];
  }

  public selectGlobalInterval(interval: Interval): void {
    this.globalInterval = interval;
    (['storage', 'trash', 'bandwidth'] as const).forEach(chart => this.fetchOverview(chart, true));
    this.scheduleSharedAutoRefresh();
  }

  private scheduleSharedAutoRefresh(): void {
    if (this.sharedTimer) clearInterval(this.sharedTimer);
    const ms = this.refreshMsFor(this.globalInterval);
    this.sharedTimer = setInterval(() => {
      (['storage', 'trash', 'bandwidth'] as const).forEach(chart => this.fetchOverview(chart, true));
    }, ms);
  }

  private scheduleUptimeAutoRefresh(): void {
    if (this.uptimeTimer) clearInterval(this.uptimeTimer);
    const ms = this.refreshMsFor(this.uptimeInterval);
    this.uptimeTimer = setInterval(() => this.fetchOverview('uptime', true), ms);
  }

  public loadOverview(force = false): void {
    this.chartKeys.forEach(chart => this.fetchOverview(chart, force));
  }

  private overviewKey(chart: ChartKey, interval: Interval, range: Range): string {
    return `${chart}:${interval}:${range}`;
  }

  private fetchOverview(chart: ChartKey, force = false): void {
    const interval = this.intervalFor(chart);
    const range = this.rangeFor(chart);
    const key = this.overviewKey(chart, interval, range);
    if (this.overviewData.has(key) && !force) {
      this.updateChart(chart);
      return;
    }
    // Fetch one extra point for accurate delta calculation on first visible point
    const pointsToFetch = range + 1;
    let url = `/api/job/overview?metric=${chart}&interval=${interval}&points=${pointsToFetch}`;

    // Add date filter parameters if provided
    if (this.dateFilterStart) {
      url += `&startDate=${this.dateFilterStart}`;
    }
    if (this.dateFilterEnd) {
      url += `&endDate=${this.dateFilterEnd}`;
    }

    this.http.get<OverviewResponse>(url).subscribe({
      next: (overview) => {
        this.overviewData.set(key, overview);
        this.updateChart(chart);
        this.lastSync = new Date();
      },
      error: () => this.toastMessage = 'Failed to load overview'
    });
  }

  public selectUptimeInterval(interval: Interval): void {
    this.uptimeInterval = interval;
    this.fetchOverview('uptime', true);
    this.scheduleUptimeAutoRefresh();
  }

  public selectChartRange(chart: ChartKey, range: Range | string): void {
    const selectedRange = Number(range) as Range;
    if (!RANGE_OPTIONS.includes(selectedRange)) return;
    if (chart === 'storage') this.storageRange = selectedRange;
    if (chart === 'trash') this.trashRange = selectedRange;
    if (chart === 'bandwidth') this.bandwidthRange = selectedRange;
    if (chart === 'payout') this.payoutRange = selectedRange;
    if (chart === 'uptime') this.uptimeRange = selectedRange;
    this.fetchOverview(chart);
  }

  private intervalFor(chart: ChartKey): Interval {
    if (chart === 'storage') return this.storageInterval;
    if (chart === 'trash') return this.trashInterval;
    if (chart === 'bandwidth') return this.bandwidthInterval;
    if (chart === 'payout') return this.payoutInterval;
    return this.uptimeInterval;
  }

  private rangeFor(chart: ChartKey): Range {
    if (chart === 'storage') return this.storageRange;
    if (chart === 'trash') return this.trashRange;
    if (chart === 'bandwidth') return this.bandwidthRange;
    if (chart === 'payout') return this.payoutRange;
    return this.uptimeRange;
  }

  public selectUnit(chart: 'storage' | 'trash' | 'bandwidth', unit: Unit): void {
    if (chart === 'storage') this.storageUnit = unit;
    else if (chart === 'trash') this.trashUnit = unit;
    else if (chart === 'bandwidth') this.bandwidthUnit = unit;
    this.updateChart(chart);
  }

  private overviewFor(interval: Interval, range: Range): OverviewResponse {
    return this.overviewData.get(this.overviewKey(chart, interval, range)) ?? { interval, points: range, data: [] };
  }

  private updateChart(chart: ChartKey): void {
    if (chart === 'storage') this.updateStorageChart();
    else if (chart === 'trash') this.updateTrashChart();
    else if (chart === 'bandwidth') this.updateBandwidthChart();
    else if (chart === 'payout') this.updatePayoutChart();
    else this.updateUptimeChart();
  }

  private updateStorageChart(): void {
    const data = this.overviewFor(this.storageInterval, this.storageRange);
    const rawValues = data.data.map(point => point.storageUsed ?? 0);
    const unit = this.resolveUnit(this.storageUnit, this.representativeBytes(rawValues));
    const values = rawValues.map(bytes => this.toUnit(bytes, unit));
    // Use all points for delta calculation, then display only the last N
    const displayValues = values.slice(-this.storageRange);
    const displayLabels = data.data.slice(-this.storageRange).map(point => this.formatLabel(point.label, this.storageInterval));
    this.storageChart = {
      ...this.storageChart,
      series: [{ name: `Storage used (${unit})`, data: displayValues }],
      xaxis: { ...this.storageChart.xaxis, categories: displayLabels },
      // Storage only grows, so "% since start of range" shrinks toward 0 as the baseline
      // grows too - not a useful signal here. Show the absolute amount only.
      tooltip: this.buildDeltaTooltip(unit, displayValues, false)
    };
    const latest = displayValues.length ? displayValues[displayValues.length - 1] : 0;
    this.storageSummary = `${this.formatNumber(latest)} ${unit}`;
    this.storageDeltaText = this.formatDelta(displayValues, unit);
  }

  private updateTrashChart(): void {
    const data = this.overviewFor(this.trashInterval, this.trashRange);
    const rawValues = data.data.map(point => point.trashUsed ?? 0);
    const unit = this.resolveUnit(this.trashUnit, this.representativeBytes(rawValues));
    const values = rawValues.map(bytes => this.toUnit(bytes, unit));
    // Use all points for delta calculation, then display only the last N
    const displayValues = values.slice(-this.trashRange);
    const displayLabels = data.data.slice(-this.trashRange).map(point => this.formatLabel(point.label, this.trashInterval));
    this.trashChart = {
      ...this.trashChart,
      series: [{ name: `Trash (${unit})`, data: displayValues }],
      xaxis: { ...this.trashChart.xaxis, categories: displayLabels },
      tooltip: this.buildDeltaTooltip(unit, displayValues)
    };
    const latest = displayValues.length ? displayValues[displayValues.length - 1] : 0;
    this.trashSummary = `${this.formatNumber(latest)} ${unit}`;
    this.trashDeltaText = this.formatDelta(displayValues, unit);
  }

  // Ingress/egress themselves only refresh once a minute (satellite poll), so below 1m their
  // real per-bucket delta is 0 for ~11 out of every 12 buckets. usedBandwidth is sampled fresh
  // from the node every 5s, so for these intervals we redistribute ITS real delta between
  // ingress/egress using the last known ingress:egress ratio, instead of a flat line.
  private isSubMinuteInterval(interval: Interval): boolean {
    return interval === '5s' || interval === '15s' || interval === '30s';
  }

  private ingressShare(ingressTotal: number, egressTotal: number): number {
    const sum = ingressTotal + egressTotal;
    return sum > 0 ? ingressTotal / sum : 0.5;
  }

  private updateBandwidthChart(): void {
    const data = this.overviewFor(this.bandwidthInterval, this.bandwidthRange);
    const rawIngress = data.data.map(point => point.ingressTotal ?? 0);
    const rawEgress = data.data.map(point => point.egressTotal ?? 0);
    const unit = this.resolveUnit(this.bandwidthUnit, Math.max(this.representativeBytes(rawIngress), this.representativeBytes(rawEgress)));
    const ingressValues = rawIngress.map(bytes => this.toUnit(bytes, unit));
    const egressValues = rawEgress.map(bytes => this.toUnit(bytes, unit));
    // Use all points for delta calculation
    let ingressDeltas = this.toBandwidthDeltaSeries(ingressValues);
    let egressDeltas = this.toBandwidthDeltaSeries(egressValues);
    const subMinute = this.isSubMinuteInterval(this.bandwidthInterval);
    if (subMinute) {
      const rawTotal = data.data.map(point => point.totalBandwidthUsed ?? 0);
      const totalValues = rawTotal.map(bytes => this.toUnit(bytes, unit));
      const totalDeltas = this.toBandwidthDeltaSeries(totalValues);
      ingressDeltas = totalDeltas.map((delta, index) => delta * this.ingressShare(rawIngress[index], rawEgress[index]));
      egressDeltas = totalDeltas.map((delta, index) => delta * (1 - this.ingressShare(rawIngress[index], rawEgress[index])));
    }
    egressDeltas = egressDeltas.map(v => -v); // Invert egress
    // Display only the last N points
    const displayIngressDeltas = ingressDeltas.slice(-this.bandwidthRange);
    const displayEgressDeltas = egressDeltas.slice(-this.bandwidthRange);
    const displayIngressValues = ingressValues.slice(-this.bandwidthRange);
    const displayEgressValues = egressValues.slice(-this.bandwidthRange);
    const displayLabels = data.data.slice(-this.bandwidthRange).map(point => this.formatLabel(point.label, this.bandwidthInterval));
    this.bandwidthChart = {
      ...this.bandwidthChart,
      series: [
        { name: 'Ingress', data: displayIngressDeltas },
        { name: 'Egress', data: displayEgressDeltas }
      ],
      xaxis: { ...this.bandwidthChart.xaxis, categories: displayLabels },
      tooltip: this.buildSignedTooltip(unit, [
        { name: 'Ingress', values: displayIngressDeltas, totals: displayIngressValues },
        { name: 'Egress', values: displayEgressDeltas.map(v => -v), totals: displayEgressValues }
      ])
    };
    // This total only spans whatever window/interval the chart happens to be showing right
    // now, so it's a secondary, window-scoped figure - not the same as the fixed last-24h
    // consumption shown on the Bandwidth metric card (see loadBandwidth24hSummary).
    const totalIngress = this.formatNumber(displayIngressValues.length ? displayIngressValues[displayIngressValues.length - 1] : 0);
    const totalEgress = this.formatNumber(displayEgressValues.length ? displayEgressValues[displayEgressValues.length - 1] : 0);
    this.bandwidthSummary = `Total Ingress: ${totalIngress} ${unit} · Total Egress: ${totalEgress} ${unit}`;
  }

  // The Bandwidth metric card is meant to answer "how much network usage in the last day",
  // independent of whatever interval/range is currently selected for the chart below it - so
  // it fetches its own fixed 49-hour window (49 hourly buckets = two adjacent 24h periods plus
  // one extra point as the delta baseline) instead of reusing bandwidthInterval/bandwidthRange.
  private loadBandwidth24hSummary(): void {
    this.http.get<OverviewResponse>('/api/job/overview?metric=bandwidth&interval=1h&points=49').subscribe({
      next: (overview) => {
        const points = overview.data;
        const end = points.length - 1;
        if (end < 1) return;
        const dayAgo = Math.max(0, end - 24);
        const twoDaysAgo = Math.max(0, end - 48);

        const nowIngress = points[end].ingressTotal ?? 0;
        const dayAgoIngress = points[dayAgo].ingressTotal ?? 0;
        const twoDaysAgoIngress = points[twoDaysAgo].ingressTotal ?? 0;
        const nowEgress = points[end].egressTotal ?? 0;
        const dayAgoEgress = points[dayAgo].egressTotal ?? 0;
        const twoDaysAgoEgress = points[twoDaysAgo].egressTotal ?? 0;

        const last24hIngressBytes = nowIngress - dayAgoIngress;
        const prev24hIngressBytes = dayAgoIngress - twoDaysAgoIngress;
        const last24hEgressBytes = nowEgress - dayAgoEgress;
        const prev24hEgressBytes = dayAgoEgress - twoDaysAgoEgress;

        const unit = this.resolveUnit(this.bandwidthUnit, Math.max(Math.abs(last24hIngressBytes), Math.abs(last24hEgressBytes)));
        const last24hIngress = this.toUnit(last24hIngressBytes, unit);
        const last24hEgress = this.toUnit(last24hEgressBytes, unit);
        const prev24hIngress = this.toUnit(prev24hIngressBytes, unit);
        const prev24hEgress = this.toUnit(prev24hEgressBytes, unit);

        this.bandwidthIngressTotal = `${this.formatNumber(last24hIngress)} ${unit}`;
        this.bandwidthEgressTotal = `${this.formatNumber(last24hEgress)} ${unit}`;
        this.bandwidthIngressDeltaText = this.formatDeltaValue(last24hIngress - prev24hIngress, prev24hIngress, unit);
        this.bandwidthEgressDeltaText = this.formatDeltaValue(last24hEgress - prev24hEgress, prev24hEgress, unit);
      }
    });
  }

  private toDeltaSeries(values: number[]): number[] {
    return values.map((value, index) => index === 0 ? value : value - values[index - 1]);
  }

  private toBandwidthDeltaSeries(values: number[]): number[] {
    return values.map((value, index) => index === 0 ? 0 : value - values[index - 1]);
  }

  private formatDelta(values: number[], unit: string): string {
    if (values.length < 2) return `+${this.formatNumber(0)} ${unit} (+0.00%)`;
    const previous = values[values.length - 2];
    const current = values[values.length - 1];
    return this.formatDeltaValue(current - previous, previous, unit);
  }

  private formatDeltaValue(delta: number, base: number, unit: string): string {
    const percent = base ? (delta / base) * 100 : 0;
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${this.formatNumber(delta)} ${unit} (${sign}${percent.toFixed(2)}%)`;
  }

  private updatePayoutChart(): void {
    const data = this.overviewFor(this.payoutInterval, this.payoutRange);
    const unit = 'USD';

    // The chart plots currentMonthPayout - the actual payout accrued so far this month
    // ("valor a receber") - not the projection. Same cents source, converted for display.
    const rawValues = data.data.map(point => point.currentMonthPayout ?? 0);
    const values = rawValues.map(val => (typeof val === 'number' ? val : parseFloat(String(val))) / 100);
    const displayValues = values.slice(-this.payoutRange);
    const displayLabels = data.data.slice(-this.payoutRange).map(point => this.formatLabel(point.label, this.payoutInterval));
    this.payoutChart = this.withData(this.payoutChart, 'Valor a receber', displayValues, displayLabels);
    const latest = displayValues.length ? displayValues[displayValues.length - 1] : 0;
    this.currentPayoutSummary = `US$ ${latest.toFixed(2)}`;
    this.currentPayoutDeltaText = this.formatDelta(displayValues, unit);

    // estimatedPayout is Storj's own projection for the full month - kept as a headline
    // number on the "Estimado" card only, with no dedicated chart of its own.
    const rawEstimatedValues = data.data.map(point => point.estimatedPayout ?? 0);
    const estimatedValues = rawEstimatedValues.map(val => (typeof val === 'number' ? val : parseFloat(String(val))) / 100);
    const displayEstimatedValues = estimatedValues.slice(-this.payoutRange);
    const latestEstimated = displayEstimatedValues.length ? displayEstimatedValues[displayEstimatedValues.length - 1] : 0;
    this.payoutSummary = `US$ ${latestEstimated.toFixed(2)}`;
    this.payoutDeltaText = this.formatDelta(displayEstimatedValues, unit);
  }

  private updateUptimeChart(): void {
    const data = this.overviewFor(this.uptimeInterval, this.uptimeRange);
    const values = data.data.map(point => point.uptimePercent ?? 100);
    // Use all points for average calculation, then display only the last N
    const displayValues = values.slice(-this.uptimeRange);
    const displayLabels = data.data.slice(-this.uptimeRange).map(point => this.formatLabel(point.label, this.uptimeInterval));
    this.uptimeChart = this.withData(this.uptimeChart, 'Uptime %', displayValues, displayLabels);
    const average = displayValues.length ? displayValues.reduce((sum, value) => sum + value, 0) / displayValues.length : 100;
    this.uptimeSummary = `Average: ${average.toFixed(2)}%`;
    this.uptimeDeltaText = this.formatDelta(displayValues, '%');
  }

  private percentChange(values: number[], index: number): number {
    const first = values[0];
    if (!first) return 0;
    return ((values[index] - first) / first) * 100;
  }

  private buildDeltaTooltip(unit: string, values: number[], showPercentSinceStart: boolean = true): ChartOptions['tooltip'] {
    return {
      theme: 'dark',
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const value = this.formatNumber(values[dataPointIndex] ?? 0);
        const hasReference = showPercentSinceStart && dataPointIndex > 0 && !!values[0];
        const percentLine = !hasReference ? '' : (() => {
          const change = this.percentChange(values, dataPointIndex);
          const sign = change >= 0 ? '+' : '';
          const color = change >= 0 ? '#c7f36b' : '#f4bb61';
          return `<div style="color:${color};margin-top:4px;">${sign}${change.toFixed(2)}% since start of range</div>`;
        })();
        return `<div style="padding:8px 10px;font:11px 'DM Mono',monospace;color:#e7ecee;background:#141b1f;border:1px solid #26323a;border-radius:6px;">`
          + `<div>${value} ${unit}</div>`
          + percentLine
          + `</div>`;
      }
    };
  }

  private buildSignedTooltip(unit: string, series: { name: string; values: number[]; totals?: number[] }[]): ChartOptions['tooltip'] {
    return {
      theme: 'dark',
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const rows = series.map(({ name, values, totals }) => {
          const delta = values[dataPointIndex] ?? 0;
          const sign = delta >= 0 ? '+' : '';
          const color = delta >= 0 ? '#c7f36b' : '#f4bb61';
          const totalLine = totals ? `<div>${this.formatNumber(totals[dataPointIndex] ?? 0)} ${unit}</div>` : '';
          return `<div style="margin-top:6px;"><strong>${name}:</strong>`
            + totalLine
            + `<span style="color:${color};">${sign}${this.formatNumber(delta)} ${unit}</span></div>`;
        }).join('');
        return `<div style="padding:8px 10px;font:11px 'DM Mono',monospace;color:#e7ecee;background:#141b1f;border:1px solid #26323a;border-radius:6px;">${rows}</div>`;
      }
    };
  }

  public createChart(color: string, name: string): ChartOptions {
    return {
      series: [{ name, data: [] }],
      chart: { height: 260, type: 'line', toolbar: { show: false }, background: 'transparent', zoom: { enabled: false } },
      dataLabels: { enabled: false }, colors: [color], stroke: { curve: 'smooth', width: 2 },
      xaxis: { categories: [], labels: { style: { colors: '#6f7b83' } }, axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { labels: { style: { colors: '#6f7b83' }, formatter: (value: number) => this.formatNumber(value) } },
      grid: { borderColor: '#26323a', strokeDashArray: 4 }, legend: { show: true, labels: { colors: '#849197' } },
      tooltip: { theme: 'dark', y: { formatter: (value: number) => this.formatNumber(value) } }
    };
  }

  private formatNumber(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  public withData(chart: ChartOptions, name: string, data: number[], labels: string[]): ChartOptions {
    return { ...chart, series: [{ name, data }], xaxis: { ...chart.xaxis, categories: labels } };
  }

  public formatLabel(label: string, interval: Interval): string {
    const date = new Date(label);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    if (interval === '5s' || interval === '15s' || interval === '30s') {
      const seconds = date.getSeconds().toString().padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    }
    return `${hours}:${minutes}`;
  }

  public toUnit(bytes: number | null, unit: ResolvedUnit): number {
    if (bytes === null || bytes === undefined) return 0;
    const divisor = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit];
    return Number((bytes / divisor).toFixed(2));
  }

  private resolveUnit(unit: Unit, referenceBytes: number): ResolvedUnit {
    if (unit !== 'Auto') return unit;
    const abs = Math.abs(referenceBytes);
    if (abs >= 1024 ** 3) return 'GB';
    if (abs >= 1024 ** 2) return 'MB';
    return 'KB';
  }

  private representativeBytes(rawValues: number[]): number {
    const last = rawValues[rawValues.length - 1];
    return last || Math.max(0, ...rawValues);
  }

  public formatValue(bytes: number | null): string {
    if (bytes === null || bytes === undefined) return 'Not available';
    const unit = this.resolveUnit('Auto', bytes);
    return `${this.toUnit(bytes, unit)} ${unit}`;
  }

  public diskUsage(node: NodeCard): number {
    if (!node.usedDiskSpace || !node.totalDiskSpace) return 0;
    return Math.min(100, Math.round((node.usedDiskSpace / node.totalDiskSpace) * 100));
  }

  // The estimated-payout API reports payout/expectation figures in cents; convert to
  // dollars here, for display only - stored/summed values stay in cents.
  public formatPayout(cents: number | null): string {
    return cents === null || cents === undefined ? 'Not available' : `US$ ${(cents / 100).toFixed(2)}`;
  }

  public payoutChangeText(node: NodeCard): string {
    const current = node.currentMonthPayout;
    const previous = node.previousMonthPayout;
    if (current === null || current === undefined || !previous) return '';
    const percent = ((current - previous) / previous) * 100;
    const sign = percent >= 0 ? '+' : '';
    return ` (${sign}${percent.toFixed(1)}%)`;
  }

  public payoutTotal(node: NodeCard): number | null {
    if (node.currentMonthPayout === null && node.previousMonthPayout === null) return null;
    return (node.currentMonthPayout ?? 0) + (node.previousMonthPayout ?? 0);
  }

  public loadNodes(): void {
    this.http.get<NodeResponse[]>('/api/job/nodes').subscribe({
      next: (nodes) => {
        this.nodes = nodes.map(node => ({
          name: `Node ${(node.nodeId || node.id).slice(0, 8)}`,
          id: node.nodeId || node.id,
          url: node.url,
          status: node.enabled ? 'Online' : 'Disabled',
          availableDiskSpace: node.availableDiskSpace,
          usedDiskSpace: node.usedDiskSpace,
          totalDiskSpace: node.totalDiskSpace,
          color: node.color ?? '#83a9ff',
          currentMonthPayout: node.currentMonthPayout,
          previousMonthPayout: node.previousMonthPayout,
          currentMonthExpectations: node.currentMonthExpectations
        }));
        this.lastSync = new Date();
      },
      error: () => this.toastMessage = 'Failed to load registered nodes'
    });
  }

  public get onlineNodes(): number {
    return this.nodes.filter(node => node.status === 'Online').length;
  }

  public selectView(view: string): void {
    this.activeView = view;
  }

  public applyDateFilter(): void {
    if (!this.dateFilterStart || !this.dateFilterEnd) {
      this.toastMessage = 'Please select both start and end dates';
      return;
    }

    const startDate = new Date(this.dateFilterStart);
    const endDate = new Date(this.dateFilterEnd);

    if (startDate > endDate) {
      this.toastMessage = 'Start date must be before end date';
      return;
    }

    // Clear cache to force new request with date filter
    this.overviewData.clear();
    this.loadOverview(true);
    this.toastMessage = `Filtered data from ${this.dateFilterStart} to ${this.dateFilterEnd}`;
  }

  public clearDateFilter(): void {
    this.dateFilterStart = '';
    this.dateFilterEnd = '';
    this.loadOverview(true);
    this.toastMessage = 'Date filter cleared';
  }
}
