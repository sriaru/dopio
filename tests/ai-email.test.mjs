import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpile(
  readFileSync(new URL("../lib/ai/email-analysis.ts", import.meta.url), "utf8"),
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
);
const { validateAnalysis, analyzeEmail } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
const candidates = [
  {
    id: "task-1",
    title: "Final artwork",
    artist: "Maya",
    release: null,
    due_date: "2026-10-01",
    version: 1,
  },
];
const body = "Please move Maya’s final artwork deadline to October 15, 2026.";
const valid = {
  task_id: "task-1",
  deadline: "2026-10-15",
  evidence: body,
  explanation: "Maya’s artwork task matches the explicit request.",
};
test("analysis validates identity, real dates and source quotes", () => {
  assert.deepEqual(validateAnalysis(valid, body, candidates), valid);
  for (const change of [
    { task_id: "foreign-task" },
    { deadline: "2026-02-30" },
    { deadline: "tomorrow" },
    { evidence: "invented quote" },
    { evidence: "" },
    { task_id: null },
  ])
    assert.throws(() =>
      validateAnalysis({ ...valid, ...change }, body, candidates),
    );
  assert.equal(
    validateAnalysis(
      {
        task_id: null,
        deadline: null,
        evidence: "",
        explanation: "Year missing.",
      },
      body,
      candidates,
    ).task_id,
    null,
  );
});
test("Responses request and success, refusal, incomplete and provider errors", async () => {
  const input = { sender: "Alex", subject: "Artwork", body };
  const mock = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const request = JSON.parse(options.body);
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.tools, undefined);
    assert.deepEqual(JSON.parse(request.input).email, input);
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(valid) }],
        },
      ],
    });
  };
  assert.deepEqual(
    await analyzeEmail(input, candidates, "test", "test-model", mock),
    valid,
  );
  for (const payload of [
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "No" }] },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "bad json" }],
        },
      ],
    },
  ])
    await assert.rejects(
      analyzeEmail(input, candidates, "test", "test-model", async () =>
        Response.json(payload),
      ),
    );
  await assert.rejects(
    analyzeEmail(
      input,
      candidates,
      "test",
      "test-model",
      async () => new Response("", { status: 429 }),
    ),
    /rate limiting/,
  );
});

test("billing errors are distinguished from temporary rate limits without exposing provider text", async () => {
  for (const [code, expected] of [
    ["credit_balance_exhausted", /Add credits/],
    ["project_spend_limit_exceeded", /project spending limit/],
    ["organization_spend_limit_exceeded", /organization spending limit/],
    ["organization_usage_limit_exceeded", /organization usage limit/],
    ["insufficient_quota", /billing balance/],
  ]) {
    await assert.rejects(
      analyzeEmail(
        { sender: "Alex", subject: "Artwork", body },
        candidates,
        "test",
        "test-model",
        async () =>
          Response.json(
            {
              error: {
                code,
                type: "insufficient_quota",
                message: "private provider text",
              },
            },
            { status: 429 },
          ),
      ),
      expected,
    );
  }
});

test("nonexistent named task cannot be substituted with another task for Maya", async () => {
  const missing = 'Please move Maya’s “Maya Test Task” deadline to October 15, 2026.';
  const output = { ...valid, evidence: missing };
  const result = await analyzeEmail(
    { sender: 'Alex', subject: 'Task deadline', body: missing },
    candidates, 'test', 'test-model', async () => Response.json({
      status: 'completed', output: [{ type: 'message', content: [
        { type: 'output_text', text: JSON.stringify(output) },
      ] }],
    }),
  );
  assert.equal(result.task_id, null);
  assert.equal(result.deadline, null);
  assert.match(result.explanation, /Needs context/);
});

test("grounding requires whole names and disambiguates duplicate tasks by release", () => {
  for (const text of [
    'Move Mayabelle’s final artwork deadline to October 15, 2026.',
    'Move Maya’s artwork deadline to October 15, 2026.',
  ]) {
    assert.equal(validateAnalysis({ ...valid, evidence: text }, text, candidates).task_id, null);
  }
  const duplicates = [
    { ...candidates[0], release: 'Demo EP' },
    { ...candidates[0], id: 'task-2', release: 'Midnight' },
  ];
  assert.equal(validateAnalysis(valid, body, duplicates).task_id, null);
  const specific = 'Move Maya’s FINAL ARTWORK for Demo EP to October 15, 2026.';
  assert.equal(validateAnalysis({ ...valid, evidence: specific }, specific, duplicates).task_id, 'task-1');
  assert.equal(validateAnalysis({ ...valid, task_id: 'task-2', evidence: specific }, specific, duplicates).task_id, null);
});

test('proposed dates must match the source; aliases work without resolving ambiguous artists',()=>{
 assert.throws(()=>validateAnalysis({...valid,deadline:'2029-10-15'},body,candidates),/source quote/);
 const ambiguous=body+' Previous deadline was October 1, 2026.';
 assert.throws(()=>validateAnalysis({...valid,evidence:ambiguous},ambiguous,candidates),/source quote/);
 const alias=[{...candidates[0],artist:'MAYA (Maya Bennett)'}];
 assert.equal(validateAnalysis(valid,body,alias).task_id,'task-1');
 assert.equal(validateAnalysis(valid,body,[...alias,{...alias[0],id:'other',artist:'MAYA (Maya Chen)'}]).task_id,null);
});
