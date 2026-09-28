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
});
