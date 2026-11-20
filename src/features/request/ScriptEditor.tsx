import { CodeEditor } from '@/components/CodeEditor';
import { t } from '@/lib/i18n';

const SNIPPETS: { label: string; code: string; listen?: 'prerequest' | 'test' }[] = [
  { label: 'Status code is 200', listen: 'test', code: 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});' },
  { label: 'Response time is less than 200ms', listen: 'test', code: 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});' },
  { label: 'Response body: JSON value check', listen: 'test', code: 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});' },
  { label: 'Response body: contains string', listen: 'test', code: 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});' },
  { label: 'Response body: is equal to a string', listen: 'test', code: 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});' },
  { label: 'Content-Type header is present', listen: 'test', code: 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});' },
  { label: 'Successful POST request', listen: 'test', code: 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});' },
  { label: 'Validate JSON schema', listen: 'test', code: 'const schema = {\n    type: "object",\n    required: ["id"],\n    properties: { id: { type: "number" } }\n};\n\npm.test("Schema is valid", function () {\n    pm.response.to.have.jsonSchema(schema);\n});' },
  { label: 'Save JSON value to environment', listen: 'test', code: 'const json = pm.response.json();\npm.environment.set("token", json.token);' },
  { label: 'Set an environment variable', code: 'pm.environment.set("variable_key", "variable_value");' },
  { label: 'Get an environment variable', code: 'pm.environment.get("variable_key");' },
  { label: 'Set a global variable', code: 'pm.globals.set("variable_key", "variable_value");' },
  { label: 'Set a collection variable', code: 'pm.collectionVariables.set("variable_key", "variable_value");' },
  { label: 'Get a variable', code: 'pm.variables.get("variable_key");' },
  { label: 'Add a header', listen: 'prerequest', code: 'pm.request.headers.add({ key: "X-Request-Id", value: pm.variables.replaceIn("{{$guid}}") });' },
  { label: 'HMAC signature (CryptoJS)', listen: 'prerequest', code: 'const ts = Date.now().toString();\nconst sig = CryptoJS.HmacSHA256(ts + pm.request.url.toString(), pm.environment.get("secret")).toString();\npm.request.headers.upsert({ key: "X-Timestamp", value: ts });\npm.request.headers.upsert({ key: "X-Signature", value: sig });' },
  { label: 'Send a request', code: 'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});' },
  { label: 'Set next request (runner)', code: 'pm.execution.setNextRequest("request_name");' },
  { label: 'Skip this request (runner)', listen: 'prerequest', code: 'pm.execution.skipRequest();' },
  { label: 'Visualize response as table', listen: 'test', code: 'const template = `<table border="1" cellpadding="4">{{#each rows}}<tr><td>{{this.id}}</td><td>{{this.name}}</td></tr>{{/each}}</table>`;\npm.visualizer.set(template, { rows: pm.response.json() });' },
];

export function ScriptEditor({
  value,
  onChange,
  listen,
  known,
}: {
  value: string;
  onChange: (v: string) => void;
  listen: 'prerequest' | 'test';
  known?: Set<string> | null;
}) {
  const insert = (code: string) => onChange(value.trim() ? `${value.replace(/\s+$/, '')}\n\n${code}\n` : `${code}\n`);
  return (
    <div className="flex h-full min-h-0">
      <CodeEditor
        value={value}
        onChange={onChange}
        language="javascript"
        scripting
        variables={known}
        className="min-w-0 flex-1"
        placeholder={listen === 'test' ? t('// Tests run after the response arrives. Try a snippet →') : t('// Runs before the request is sent.')}
      />
      <div className="w-56 shrink-0 overflow-auto border-l border-border p-2">
        <div className="mb-1 text-[11px] font-semibold text-muted-foreground uppercase">{t('Snippets')}</div>
        {SNIPPETS.filter((s) => !s.listen || s.listen === listen).map((s) => (
          <button key={s.label} type="button" onClick={() => insert(s.code)} className="block w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-accent hover:bg-surface-hover" title={t(s.label)}>
            {t(s.label)}
          </button>
        ))}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('Scripts run in a Postman-compatible sandbox:')} <code>pm.*</code>, chai, CryptoJS, <code>pm.sendRequest</code>. {t('Collection and folder scripts run first.')}
        </p>
      </div>
    </div>
  );
}
