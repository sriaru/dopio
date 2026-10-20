import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const root = new URL("../supabase/migrations/", import.meta.url);
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
test("Gmail member-owned credentials, scoped import, provenance, dedupe and disconnect", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${alice}'),('${bob}');`,
    );
    for (const file of (await readdir(root))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, root), "utf8"));
    const user = async (id) =>
      db.exec(
        `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
      );
    await user(alice);
    const wa = (
      await db.query(
        "select save_workspace_onboarding('Alice','Artist Manager','','1–2','Alice workspace',true) id",
      )
    ).rows[0].id;
    await user(bob);
    const wb = (
      await db.query(
        "select save_workspace_onboarding('Bob','Artist Manager','','1–2','Bob workspace',true) id",
      )
    ).rows[0].id;
    await user(alice);
    const connection = (
      await db.query(
        "insert into gmail_connections(workspace_id,user_id,email,encrypted_refresh_token) values($1,$2,'alice@example.com',$3) returning connection_id",
        [wa, alice, "encrypted-placeholder-for-db-tests"],
      )
    ).rows[0].connection_id;
    const imp = async (workspace = wa, c = connection) =>
      (
        await db.query(
          "select import_gmail_message($1,$2,'abc123','Alex','Artwork','Move Artwork to October 15, 2026.','2026-09-30T12:00:00Z') id",
          [workspace, c],
        )
      ).rows[0].id;
    const id = await imp();
    assert.equal(await imp(), id);
    const message = (
      await db.query("select * from inbox_messages where id=$1", [id])
    ).rows[0];
    assert.equal(message.source, "gmail");
    assert.equal(message.provider_account, "alice@example.com");
    assert.equal(message.provider_message_id, "abc123");
    assert.equal(message.body, "Move Artwork to October 15, 2026.");
    assert.equal(
      (await db.query("select * from deadline_proposals")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from tasks")).rows.length, 0);
    assert.equal(
      (
        await db.query(
          "select * from workspace_activity where entity_type='email'",
        )
      ).rows.length,
      1,
    );
    await assert.rejects(imp(wb));
    await user(bob);
    assert.equal(
      (await db.query("select * from gmail_connections")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from inbox_messages")).rows.length,
      0,
    );
    await assert.rejects(imp());
    await assert.rejects(
      db.query(
        "insert into gmail_connections(workspace_id,user_id,email,encrypted_refresh_token) values($1,$2,'a@example.com','encrypted-placeholder-for-db-tests')",
        [wa, alice],
      ),
    );
    // Even another member of the SAME workspace cannot read/use Alice's connection.
    await db.exec("reset role");
    await db.query(
      "insert into workspace_members(workspace_id,user_id) values($1,$2)",
      [wa, bob],
    );
    await user(bob);
    assert.equal(
      (await db.query("select * from gmail_connections")).rows.length,
      0,
    );
    await assert.rejects(imp());
    assert.equal(
      (await db.query("select * from inbox_messages where id=$1", [id])).rows
        .length,
      1,
    );
    await user(alice);
    await db.query("delete from gmail_connections where connection_id=$1", [
      connection,
    ]);
    await assert.rejects(imp());
    assert.equal(
      (await db.query("select * from inbox_messages where id=$1", [id])).rows
        .length,
      1,
    );
    const replacement = (
      await db.query(
        "insert into gmail_connections(workspace_id,user_id,email,encrypted_refresh_token) values($1,$2,'alice@example.com','encrypted-placeholder-for-db-tests') returning connection_id",
        [wa, alice],
      )
    ).rows[0].connection_id;
    await assert.rejects(imp(wa, connection));
    assert.equal(await imp(wa, replacement), id);
    const artist = (await db.query("insert into artists(workspace_id,name) values($1,'Daniel') returning record_id",[wa])).rows[0].record_id;
    const task = (await db.query("insert into tasks(workspace_id,artist_id,title,due_date) values($1,$2,'Artwork','2026-10-01') returning id",[wa,artist])).rows[0].id;
    const analyze = async (revision, taskId=null, version=null, date=null, evidence='', workspace=wa) => (await db.query("select save_gmail_analysis($1,$2,$3,$4,$5,$6,$7,'Review this result') result",[workspace,id,revision,taskId,version,date,evidence])).rows[0].result;
    await assert.rejects(analyze(0,null,null,null,'',wb));
    assert.equal(await analyze(0),'needs_context');
    await assert.rejects(analyze(0));
    await assert.rejects(analyze(1,task,1,'2026-10-15','Invented quote'));
    assert.equal(await analyze(1,task,99,'2026-10-15','Move Artwork to October 15, 2026.'),'needs_context');
    assert.equal(await analyze(2,task,1,'2026-10-15','Move Artwork to October 15, 2026.'),'proposal');
    assert.equal(await analyze(2,task,1,'2026-10-15','Move Artwork to October 15, 2026.'),'proposal');
    assert.equal((await db.query('select count(*)::int n from deadline_proposals where message_id=$1',[id])).rows[0].n,1);
    assert.equal((await db.query('select due_date::text d from tasks where id=$1',[task])).rows[0].d,'2026-10-01');
    const proposal=(await db.query('select id from deadline_proposals where message_id=$1',[id])).rows[0].id;
    assert.equal((await db.query('select decide_deadline_proposal($1,true) result',[proposal])).rows[0].result,'approved');
    assert.equal((await db.query('select due_date::text d from tasks where id=$1',[task])).rows[0].d,'2026-10-15');
    assert.equal(await analyze(3),'proposal');
    const original=(await db.query('select body,source,provider_message_id from inbox_messages where id=$1',[id])).rows[0];
    assert.deepEqual(original,{body:'Move Artwork to October 15, 2026.',source:'gmail',provider_message_id:'abc123'});
    await db.exec("reset role;set role anon");
    await assert.rejects(db.query("select * from gmail_connections"));
    await assert.rejects(imp());
    await assert.rejects(analyze(3));
  } finally {
    await db.close();
  }
});
