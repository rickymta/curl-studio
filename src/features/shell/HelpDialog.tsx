import { AlertCircle, CheckCircle2, FolderOpen, Keyboard, ListChecks, Send } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, cn, Input, Modal, Spinner, Tabs, Textarea } from '@/components/ui';
import { api } from '@/lib/ipc';
import { revealPath } from '@/lib/native';
import { useUi } from '@/stores/ui';

import { emptyForm, LIMITS, TOPICS, toRequest, validate, type FieldName, type FormErrors, type SupportForm } from './support';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

const ID_KEY = 'curlstudio.support.identity';

function savedIdentity(): { name: string; email: string } {
  try {
    const v = JSON.parse(localStorage.getItem(ID_KEY) ?? 'null') as { name?: string; email?: string } | null;
    return { name: v?.name ?? '', email: v?.email ?? '' };
  } catch {
    return { name: '', email: '' };
  }
}

function FormField({ label, error, htmlFor, children }: { label: string; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] text-muted-foreground">
        {label}
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      </label>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

export function About() {
  const [info, setInfo] = useState<{ version: string; dataDir: string; os: string; arch: string } | null>(null);
  useEffect(() => {
    api.info().then(setInfo).catch(() => undefined);
  }, []);
  const show = useUi.getState().show;
  const row = (k: string, v: ReactNode) => (
    <div className="flex gap-3 border-b border-border py-2 last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{k}</span>
      <span className="selectable min-w-0 flex-1 font-mono text-[12.5px] break-all">{v}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10" />
        <div>
          <div className="text-[16px] font-semibold">CurlStudio</div>
          <div className="text-[12.5px] text-muted-foreground">API client and load-testing studio · Postman, JMeter and k6 ideas in one app</div>
        </div>
      </div>
      <div className="rounded-md border border-border px-3 text-[13px]">
        {row('App version', __APP_VERSION__)}
        {row('Core version', info?.version ?? '…')}
        {row('System', info ? `${info.os} (${info.arch})` : '…')}
        {row(
          'Workspace folder',
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">{info?.dataDir ?? '…'}</span>
            {info && (
              <Button size="sm" variant="ghost" onClick={() => revealPath(info.dataDir)}>
                <FolderOpen className="size-3.5" /> Open
              </Button>
            )}
          </span>,
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => show({ kind: 'shortcuts' })}>
          <Keyboard className="size-3.5" /> Keyboard shortcuts
        </Button>
        <Button size="sm" onClick={() => show({ kind: 'activity' })}>
          <ListChecks className="size-3.5" /> Activity logs
        </Button>
      </div>
    </div>
  );
}

/** Help & Support: a support form (sent as an email, as in GitStudio) and an About page. */
export function HelpDialog({ onClose, initialTab = 'contact' }: { onClose: () => void; initialTab?: 'contact' | 'about' }) {
  const [tab, setTab] = useState<'contact' | 'about'>(initialTab);
  const [form, setForm] = useState<SupportForm>(() => ({ ...emptyForm(), ...savedIdentity() }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [system, setSystem] = useState<{ os: string; arch: string } | null>(null);
  useEffect(() => {
    api.supportSystemInfo().then(setSystem).catch(() => undefined);
  }, []);
  const sending = status.kind === 'sending';

  const set = <K extends keyof SupportForm>(key: K, value: SupportForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
    if (status.kind === 'error') setStatus({ kind: 'idle' });
  };

  const close = () => {
    if (!sending) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const errs = validate(form);
    setErrors(errs);
    const first = (Object.keys(errs) as FieldName[])[0];
    if (first) {
      document.getElementById(`help-${first}`)?.focus();
      return;
    }
    try {
      localStorage.setItem(ID_KEY, JSON.stringify({ name: form.name.trim(), email: form.email.trim() }));
    } catch {
      /* not remembered */
    }
    setStatus({ kind: 'sending' });
    try {
      await api.sendSupport(toRequest(form, __APP_VERSION__));
      setStatus({ kind: 'sent' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const aria = (name: FieldName) => ({
    id: `help-${name}`,
    'aria-invalid': !!errors[name] || undefined,
    'aria-describedby': errors[name] ? `help-${name}-error` : undefined,
    disabled: sending,
    className: cn(errors[name] && 'border-danger focus:border-danger'),
  });

  return (
    <Modal open onClose={close} width={620} title="Help & Support" description="Report a problem, suggest a feature or ask a question. We reply by email.">
      <div className="-mx-1 mb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'contact', label: 'Contact support' },
            { id: 'about', label: 'About' },
          ]}
        />
      </div>
      {tab === 'about' ? (
        <About />
      ) : status.kind === 'sent' ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" />
          <div className="text-[15px] font-semibold">Message sent</div>
          <p className="max-w-sm text-muted-foreground">Thanks! We will reply to {form.email.trim()}.</p>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => {
                setForm((f) => ({ ...emptyForm(), name: f.name, email: f.email }));
                setStatus({ kind: 'idle' });
              }}
            >
              Send another
            </Button>
            <Button variant="primary" onClick={close} data-autofocus>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Name" htmlFor="help-name" error={errors.name}>
              <Input {...aria('name')} maxLength={LIMITS.name} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </FormField>
            <FormField label="Email" htmlFor="help-email" error={errors.email}>
              <Input {...aria('email')} type="email" autoComplete="email" spellCheck={false} placeholder="you@example.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </FormField>
          </div>
          <FormField label="What do you need help with?" htmlFor="help-topic" error={errors.topic}>
            <select
              {...aria('topic')}
              value={form.topic}
              onChange={(e) => set('topic', e.target.value as SupportForm['topic'])}
              className={cn('h-8 rounded-md border border-border bg-background px-2 outline-none focus:border-accent', errors.topic && 'border-danger', !form.topic && 'text-muted-foreground')}
            >
              <option value="" disabled>
                Choose a topic
              </option>
              {TOPICS.map((o) => (
                <option key={o.value} value={o.value} className="text-foreground">
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Subject" htmlFor="help-subject" error={errors.subject}>
            <Input {...aria('subject')} maxLength={LIMITS.subject} value={form.subject} onChange={(e) => set('subject', e.target.value)} />
          </FormField>
          <FormField label="Message" htmlFor="help-message" error={errors.message}>
            <Textarea
              {...aria('message')}
              rows={6}
              maxLength={LIMITS.message}
              placeholder="Describe the problem or idea. For a bug, list the steps to reproduce it."
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
            />
          </FormField>
          <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--accent)]" checked={form.includeSystem} disabled={sending} onChange={(e) => set('includeSystem', e.target.checked)} />
            <span>
              Attach app version and operating system
              <span className="block font-mono">
                CurlStudio {__APP_VERSION__}
                {system && ` · ${system.os} (${system.arch})`}
              </span>
            </span>
          </label>
          {status.kind === 'error' && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Could not send your message.</div>
                <div className="text-[12px] break-words opacity-90">{status.message}</div>
              </div>
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button onClick={close} disabled={sending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={sending}>
              {sending ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}
              {sending ? 'Sending…' : status.kind === 'error' ? 'Try again' : 'Submit'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
