import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let http: jasmine.SpyObj<HttpClient>;

  beforeEach(async () => {
    http = jasmine.createSpyObj<HttpClient>('HttpClient', ['get']);
    http.get.and.returnValue(of({ interval: '5m', points: 31, data: [] }) as never);
    http.get.withArgs('/api/job/nodes').and.returnValue(of([]) as never);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: HttpClient, useValue: http }]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads each chart separately on startup', () => {
    const overviewRequests = http.get.calls.allArgs()
      .map(([url]) => String(url))
      .filter(url => url.startsWith('/api/job/overview'));

    expect(overviewRequests.filter(url => url.includes('metric=storage')).length).toBe(1);
    expect(overviewRequests.filter(url => url.includes('metric=trash')).length).toBe(1);
    expect(overviewRequests.filter(url => url.includes('metric=bandwidth')).length).toBe(2);
    expect(overviewRequests.filter(url => url.includes('metric=uptime')).length).toBe(1);
    expect(overviewRequests.filter(url => url.includes('metric=payout')).length).toBe(1);
  });

  it('requests only the selected chart when its point range changes', () => {
    const requestCount = http.get.calls.count();

    component.selectChartRange('trash', '10');

    expect(http.get.calls.count()).toBe(requestCount + 1);
    expect(http.get.calls.mostRecent().args[0]).toContain('metric=trash');
    expect(http.get.calls.mostRecent().args[0]).toContain('points=11');
  });

  it('formats bandwidth tooltip totals and changes using each value’s own unit', () => {
    const gb = 1024 ** 3;
    const mb = 1024 ** 2;
    const kb = 1024;
    http.get.withArgs('/api/job/overview?metric=bandwidth&interval=5m&points=11').and.returnValue(of({
      interval: '5m', points: 11, data: [
        { label: '2026-09-27T10:00:00Z', ingressTotal: gb, egressTotal: 512, totalBandwidthUsed: 0 },
        { label: '2026-09-27T10:05:00Z', ingressTotal: gb + 512 * kb, egressTotal: 768, totalBandwidthUsed: 0 },
        { label: '2026-09-27T10:10:00Z', ingressTotal: gb + 512 * kb + 512, egressTotal: 768 + mb, totalBandwidthUsed: 0 }
      ]
    }) as never);

    component.selectChartRange('bandwidth', '10');
    const tooltip = component.bandwidthChart.tooltip.custom as (options: { dataPointIndex: number }) => string;
    const firstChange = tooltip({ dataPointIndex: 1 });
    expect(firstChange).toContain('1 GB');
    expect(firstChange).toContain('+512 KB');
    expect(firstChange).toContain('768 B');
    expect(firstChange).toContain('+256 B');

    const secondChange = tooltip({ dataPointIndex: 2 });
    expect(secondChange).toContain('+512 B');
    expect(secondChange).toContain('+1 MB');
  });
});
