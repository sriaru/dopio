import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
const auth = await readFile(
  new URL(
    "../supabase/migrations/202609260001_workspace_auth.sql",
    import.meta.url,
  ),
  "utf8",
);
const records = await readFile(
  new URL(
    "../supabase/migrations/202609260002_workspace_records.sql",
    import.meta.url,
  ),
  "utf8",
);
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
for (const idType of [
  "uuid primary key default gen_random_uuid()",
  "bigserial primary key",
])
  test(`workspace CRUD and isolation with ${idType.split(" ")[0]} legacy artist IDs`, async () => {
    const db = new PGlite();
    try {
      await db.exec(
        `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;insert into auth.users values('${alice}'),('${bob}');create table public.artists(id ${idType},name text not null,genre text,status text default 'Active',created_at timestamptz default now());insert into artists(name) values('Legacy artist');`,
      );
      await db.exec(auth);
      await db.exec(records);
      async function asUser(id) {
        await db.exec(
          `reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`,
        );
      }
      async function setup(id, name) {
        await asUser(id);
        return (
          await db.query(
            "select save_workspace_onboarding($1,'Artist Manager','','1–2',$2,true) id",
            [name, name + " workspace"],
          )
        ).rows[0].id;
      }
      const wa = await setup(alice, "Alice");
      const wb = await setup(bob, "Bob");
      const bArtist = (
        await db.query(
          "insert into artists(workspace_id,name,genre,status) values($1,'Bob artist','','Active') returning record_id",
          [wb],
        )
      ).rows[0].record_id;
      await asUser(alice);
      const aArtist = (
        await db.query(
          "insert into artists(workspace_id,name,genre,status) values($1,'My real artist','Pop','Active') returning record_id",
          [wa],
        )
      ).rows[0].record_id;
      const otherArtist = (
        await db.query(
          "insert into artists(workspace_id,name,genre,status) values($1,'Second artist','','Active') returning record_id",
          [wa],
        )
      ).rows[0].record_id;
      assert.deepEqual(
        (await db.query("select name from artists order by name")).rows.map(
          (r) => r.name,
        ),
        ["My real artist", "Second artist"],
      );
      const release = (
        await db.query(
          "insert into releases(workspace_id,artist_id,title,release_date) values($1,$2,'Real release','2026-12-01') returning id",
          [wa, aArtist],
        )
      ).rows[0].id;
      const task = (
        await db.query(
          "insert into tasks(workspace_id,artist_id,release_id,title) values($1,$2,$3,'Deliver artwork') returning id",
          [wa, aArtist, release],
        )
      ).rows[0].id;
      await db.query("update tasks set status='Complete' where id=$1", [task]);
      assert.equal(
        (await db.query("select status from tasks where id=$1", [task])).rows[0]
          .status,
        "Complete",
      );
      assert.equal(
        (
          await db.query(
            "select action from workspace_activity where entity_id=$1 order by sequence desc",
            [task],
          )
        ).rows[0].action,
        "updated",
      );
      assert.equal(
        (
          await db.query(
            "select actor_id from workspace_activity where entity_id=$1",
            [task],
          )
        ).rows[0].actor_id,
        alice,
      );
      await assert.rejects(
        () => db.query("delete from artists where record_id=$1", [aArtist]),
        /foreign key/,
      );
      await assert.rejects(
        () => db.query("delete from releases where id=$1", [release]),
        /foreign key/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into releases(workspace_id,artist_id,title) values($1,$2,'Cross tenant')",
            [wa, bArtist],
          ),
        /foreign key/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into tasks(workspace_id,artist_id,release_id,title) values($1,$2,$3,'Wrong artist')",
            [wa, otherArtist, release],
          ),
        /foreign key/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into tasks(workspace_id,release_id,title) values($1,$2,'Missing artist')",
            [wa, release],
          ),
        /check constraint/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into tasks(workspace_id,title,status) values($1,'Invalid task','Unknown')",
            [wa],
          ),
        /check constraint/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into releases(workspace_id,artist_id,title,release_date) values($1,$2,'Invalid date','1800-01-01')",
            [wa, aArtist],
          ),
        /check constraint/,
      );
      await assert.rejects(
        () =>
          db.query("update artists set workspace_id=$1 where record_id=$2", [
            wb,
            aArtist,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query("update releases set workspace_id=$1 where id=$2", [
            wb,
            release,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query("delete from workspace_activity"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into workspace_activity(workspace_id,entity_type,entity_id,action,title) values($1,'task',$2,'created','Forged')",
            [wa, task],
          ),
        /permission denied/,
      );
      await asUser(bob);
      for (const table of ["releases", "tasks"])
        assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      assert.equal(
        (
          await db.query(
            "select * from workspace_activity where workspace_id=$1",
            [wa],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "update tasks set status='Pending' where id=$1 returning id",
            [task],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query("delete from releases where id=$1 returning id", [
            release,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into tasks(workspace_id,title) values($1,'Other workspace')",
            [wa],
          ),
        /row-level security/,
      );
      await asUser(alice);
      const general = (
        await db.query(
          "insert into tasks(workspace_id,title) values($1,'General task') returning id",
          [wa],
        )
      ).rows[0].id;
      await db.query("delete from tasks where id=$1", [general]);
      await db.query("delete from tasks where id=$1", [task]);
      await db.query("delete from releases where id=$1", [release]);
      await db.query("delete from artists where record_id=$1", [aArtist]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from workspace_activity where action='deleted'",
          )
        ).rows[0].n,
        4,
      );
      await db.exec("reset role;");
      const legacy = (
        await db.query(
          "select record_id from artists where name='Legacy artist'",
        )
      ).rows[0].record_id;
      await db.query("update artists set workspace_id=$1 where record_id=$2", [
        wa,
        legacy,
      ]);
      await asUser(alice);
      assert.equal(
        (
          await db.query("select name from artists where record_id=$1", [
            legacy,
          ])
        ).rows[0].name,
        "Legacy artist",
      );
      await asUser(bob);
      assert.equal(
        (
          await db.query("select name from artists where record_id=$1", [
            legacy,
          ])
        ).rows.length,
        0,
      );
      await db.exec("reset role;set role anon;");
      for (const table of [
        "artists",
        "releases",
        "tasks",
        "workspace_activity",
      ])
        await assert.rejects(
          () => db.query(`select * from ${table}`),
          /permission denied/,
        );
    } finally {
      await db.close();
    }
  });
