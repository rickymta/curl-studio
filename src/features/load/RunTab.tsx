import { Download, Octagon, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge, Button, Dropdown, Empty, Spinner, Textarea } from '@/components/ui';
import { formatDuration } from '@/lib/format';
import { t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { aggregateCsv, htmlReport, junitXml, markdownSummary, timelineCsv } from '@/lib/load/report';
import type { Point, RunRecord, Summary } from '@/lib/load/types';
import { copyText, saveText } from '@/lib/native';
import { slug } from '@/lib/format';
import { logActivity } from '@/stores/activity';
import { errText, toast } from '@/stores/ui';

import { minP95, ReportBody, type ReportData } from './RunReport';
import { useRuns } from './runs';
import { startScenario } from './start';

export async function exportRun(run: RunRecord, kind: 'html' | 'html-dark' | 'json' | 'csv' | 'aggregate' | 'junit' | 'md') {
  const base = `${slug(run.name)}-${run.id}`;
  try {
    let ok = false;
    switch (kind) {
      case 'html':
      case 'html-dark':
        ok = await saveText(`${base}.html`, htmlReport(run, kind === 'html' ? 'light' : 'dark'), [{ name: 'HTML', extensions: ['html'] }]);
        break;
      case 'json':
        ok = await saveText(`${base}.json`, JSON.stringify(run, null, 2), [{ name: 'JSON', extensions: ['json'] }]);
        break;
      case 'csv':
        ok = await saveText(`${base}-timeline.csv`, timelineCsv(run), [{ name: 'CSV', extensions: ['csv'] }]);
        break;
      case 'aggregate':
        ok = await saveText(`${base}-aggregate.csv`, aggregateCsv(run.summary), [{ name: 'CSV', extensions: ['csv'] }]);
        break;
      case 'junit':
        ok = await saveText(`${base}-junit.xml`, junitXml(run), [{ name: 'XML', extensions: ['xml'] }]);
        break;
      case 'md':
        await copyText(markdownSummary(run));
        toast('success', t('Markdown summary copied'));
        return;
    }
    if (ok) toast('success', t('Report exported'));
  } catch (e) {
    toast('error', errText(e));
  }
}

export function ExportMenu({ run }: { run: RunRecord }) {
  return (
    <Dropdown
      items={[
        { label: t('HTML report (light)'), onSelect: () => exportRun(run, 'html') },
        { label: t('HTML report (dark)'), onSelect: () => exportRun(run, 'html-dark') },
        'sep',
        { label: t('Raw results (JSON)'), onSelect: () => exportRun(run, 'json') },
        { label: t('Timeline per second (CSV)'), onSelect: () => exportRun(run, 'csv') },
        { label: t('Aggregate report (CSV)'), onSelect: () => exportRun(run, 'aggregate') },
        { label: 'JUnit XML (CI)', onSelect: () => exportRun(run, 'junit') },
        { label: t('Copy Markdown summary'), onSelect: () => exportRun(run, 'md') },
      ]}
    >
      <Button size="sm">
        <Download className="size-3.5" /> {t('Export')}
      </Button>
    </Dropdown>
  );
}

export function RunTab({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [live, setLive] = useState<{ points: Point[]; summary: Summary | null; elapsed: number; planned: number; vus: number; state: string; reason: string | null; bounds: number[]; name: string; stepNames: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const lastT = useRef<number | undefined>(undefined);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const done = (r: RunRecord) => {
      if (useRuns.getState().runs.find((x) => x.id === runId) === undefined || useRuns.getState().live.includes(runId)) {
        const s = r.summary;
        logActivity({
          cat: 'load',
          label: `Load test ${s.verdict === 'passed' ? 'passed' : 'failed'}: ${r.name}`,
          status: s.verdict === 'passed' ? 'finished' : 'failed',
          ms: Math.round(s.durationS * 1000),
          detail: `${s.requests ?? ''} requests${r.reason ? ` · ${r.reason}` : ''}`,
        });
      }
      setRun(r);
      setNotes(r.meta?.notes ?? '');
      setLive(null);
      useRuns.getState().setLive(runId, false);
      useRuns.getState().refresh();
    };
    const tick = async () => {
      try {
        const st = await api.loadStatus(runId, lastT.current);
        if (stop) return;
        if (st.done && st.run) {
          done(st.run);
          return;
        }
        const pts = st.points ?? [];
        if (pts.length) lastT.current = pts[pts.length - 1]!.t;
        setLive((prev) => ({
          points: [...(prev?.points ?? []), ...pts],
          summary: st.summary ?? null,
          elapsed: st.elapsedS ?? 0,
          planned: st.plannedS ?? 0,
          vus: st.vus ?? 0,
          state: st.state,
          reason: st.reason ?? null,
          bounds: st.heatBoundsMs ?? [],
          name: prev?.name ?? '',
          stepNames: prev?.stepNames ?? {},
        }));
        timer = setTimeout(tick, 1000);
      } catch {
        // Not a live run (app restarted): load the saved record.
        try {
          const r = await api.get<RunRecord>('loadRuns', runId);
          if (!stop) done(r);
        } catch (e) {
          if (!stop) setError(errText(e));
        }
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (error) return <Empty title={t('Run not found')}>{error}</Empty>;
  if (!run && !live) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (live && !run) {
    const s = live.summary;
    const pct = live.planned ? Math.min(100, (live.elapsed / live.planned) * 100) : 0;
    const scenario = useRuns.getState().runs.find((r) => r.id === runId);
    const d: ReportData | null = s
      ? { name: scenario?.name ?? 'Load test', summary: s, timeline: live.points, heatBoundsMs: live.bounds, stepNames: Object.fromEntries(s.steps.map((x) => [x.id, x.name])) }
      : null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
          <Spinner className="text-accent" />
          <div className="min-w-0">
            <div className="font-semibold">{t('Running…')} {live.state === 'stopping' && <Badge tone="warning">{t('stopping (graceful)')}</Badge>}</div>
            <div className="text-[12px] text-muted-foreground">
              {formatDuration(live.elapsed)} / {formatDuration(live.planned)} · {t('{n} VUs active', { n: live.vus })} {live.reason && `· ${live.reason}`}
            </div>
          </div>
          <div className="mx-4 h-1.5 flex-1 overflow-hidden rounded bg-surface-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <Button size="sm" onClick={() => api.loadStop(runId, false)}>
            <Square className="size-3.5" /> {t('Stop')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => api.loadStop(runId, true)} title={t('Abandon in-flight requests')}>
            <Octagon className="size-3.5" /> {t('Kill')}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{d ? <ReportBody d={d} /> : <Empty title={t('Waiting for the first samples…')} />}</div>
      </div>
    );
  }

  const r = run!;
  const s = r.summary;
  const d: ReportData = {
    name: r.name,
    summary: s,
    timeline: r.timeline,
    heatBoundsMs: r.heatBoundsMs,
    stepNames: Object.fromEntries((r.scenario?.steps ?? []).map((x) => [x.id, x.name])),
    thresholdP95: minP95(r),
  };
  const saveNotes = async () => {
    const next = { ...r, meta: { ...(r.meta ?? {}), notes } };
    await api.put('loadRuns', r.id, next);
    setRun(next);
    toast('success', t('Notes saved'));
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Badge tone={s.verdict === 'passed' ? 'success' : 'danger'} className="px-2 py-1 text-[13px]">
          {s.verdict === 'passed' ? t('PASSED') : t('FAILED')}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{r.name}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {new Date(r.startedAt).toLocaleString()} · {formatDuration(s.durationS)} · {r.meta?.testType ?? ''} {r.meta?.environment ? `· env ${r.meta.environment}` : ''} {r.reason ? `· ${r.reason}` : ''}
          </div>
        </div>
        {r.meta?.scenarioId && (
          <Button size="sm" onClick={() => startScenario(r.meta!.scenarioId!)}>
            <RotateCcw className="size-3.5" /> {t('Run again')}
          </Button>
        )}
        <ExportMenu run={r} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <ReportBody d={d} />
        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          <div className="mb-1 text-[12.5px] font-semibold">{t('Notes')}</div>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Observations, build/version under test, follow-ups… (included in the HTML report)')} />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={saveNotes}>
              {t('Save notes')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
