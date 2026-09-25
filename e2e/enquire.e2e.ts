/**
 * THE PUBLIC ENQUIRY FORM IN A REAL BROWSER, ON A BUILT ADMINIUM — held to
 * what a stranger with the page's key could try.
 *
 * One Adminium (the contract's harness, its clock at 10:00 on Tuesday 28 July
 * 2026) with the add-on, this app and the sample. Then, as a visitor with no
 * sign-in at `/apps/clients/customer/enquire`, in light, dark, Arabic and at
 * phone width — shot and swept by axe:
 *   - the empty form and its problems (nothing is sent);
 *   - the human check: the page asks Adminium's own challenge and sends its
 *       proof; the check shown while it runs; a proof the server will not
 *       take, said in words;
 *   - sent: the enquiry is on the desk as a NEW one from the WEB, and the page
 *       shows when it arrived and nothing else;
 *   - the limits: three a day from one address, thirty an hour through the
 *       page, and too many at once from one connection — each in words.
 * And over the wire, as a script would try it:
 *   - no proof, a made-up proof, a proof for something else, a proof used
 *       twice: refused, nothing made;
 *   - every column the studio decides (status, source, fit, number, client …)
 *       sent anyway: refused by the server, nothing made;
 *   - nothing to read back: no list, no row, no change, no delete; a create
 *       answers only when it arrived;
 *   - a name that is not a plain name (markup, a link): refused;
 *   - markup and links in what they wrote reach the desk as text, and the
 *       studio's email quotes it as text and carries only what its words say.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

import { ok, solve, until, type Engine } from "../src/contract/harness.ts";
import { check, newContext, SHOTS, SWEEPS, sweep, VARIANTS, type Variant } from "./browser.ts";
import { Desk, DESK, screenOf } from "./desk.ts";
import { PORTAL } from "./portal.ts";
import { stackUp, type Stack } from "./stack.ts";
import { localeOf, say } from "./words.ts";

// The server and its mail sink take this port and the next two; 5060 and 5061 are ports every browser and `fetch` refuse (SIP).
const PORT = Number(process.env["E2E_PORT"] ?? 5062);
const FORM = `${PORTAL}enquire`;
/** Where the studio's notices go: an address the outbox sends to (it skips the sample's reserved `.example`). */
const STUDIO_MAIL = "studio@outline-e2e.dev";
/** The limits the enquiry door declares. */
const PER_ADDRESS = 3;
const PER_KEY_HOUR = 30;
/**
 * The door's writes a minute from one visitor: every endpoint an app's
 * manifest makes carries its own limit of 60 a minute (which takes the place
 * of the public write class's 20), counted before the human check is looked at.
 */
const WRITES_A_MINUTE = 60;
/** Every column of an enquiry a visitor may not set. */
const DECIDED_BY_THE_STUDIO: Record<string, unknown> = {
  status: "proposal",
  source: "Referral from a friend",
  fit: "good",
  number: "ENQ-999",
  number_seq: 999,
  client_id: 1,
  proposal_id: 1,
  received_at: "2020-01-01T00:00:00.000Z",
  parked_until: "2030-01-01",
  client_key: "00000000-0000-4000-8000-000000000000",
  id: 999_999,
};

let engine: Engine;
let stack: Stack;
/** The page's browser key, the enquiry door's ref and the enquiries' real table. */
let key = "";
let door = "";
/** The web enquiries this run made through the key — what the per-hour cap counts. */
let made = 0;
/** The sample's own enquiries from the web, before this run added any. */
let webBefore = 0;

// ── the server's write budget, as this run spends it ────────────────────────

/**
 * Every write this run sends from this machine (the page's and the script's),
 * so a step that must be ANSWERED — not turned away for coming too fast —
 * waits until Adminium's minute has room. The server's window is fixed from
 * its first write; any write inside it is also inside the last minute, so
 * fewer than the limit in the last 61 s means room.
 */
const writes: number[] = [];
function wrote(): void {
  writes.push(Date.now());
}
/** Wait until `n` more writes fit in Adminium's minute (`WRITES_A_MINUTE - 1` waits for an empty one). */
async function room(n = 1): Promise<void> {
  for (;;) {
    const since = Date.now() - 61_000;
    while (writes.length > 0 && writes[0]! < since) writes.shift();
    if (writes.length + n < WRITES_A_MINUTE) return;
    await new Promise((resolve) => setTimeout(resolve, writes[0]! + 61_500 - Date.now()));
  }
}

// ── speaking to the door as a script would ──────────────────────────────────

interface Answer {
  status: number;
  code: string | undefined;
  params: Record<string, unknown>;
  body: Record<string, unknown> | null;
}

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> {
  if (method !== "GET") {
    await room();
    wrote();
  }
  const res = await fetch(`${stack.server.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, origin: stack.server.base, ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const parsed = text === "" ? null : (JSON.parse(text) as Record<string, unknown>);
  const error = (parsed?.["error"] ?? null) as { code?: string; params?: Record<string, unknown> } | null;
  return { status: res.status, code: error?.code, params: error?.params ?? {}, body: parsed };
}

/** A proof as the page makes one: Adminium's challenge, solved. */
async function proof(purpose: "write" | "claim" = "write"): Promise<string> {
  const challenge = (await call("GET", `/api/v1/public/challenge?purpose=${purpose}`)).body!["data"] as { id: string; salt: string; difficulty: number };
  return `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`;
}

const create = async (values: Record<string, unknown>, headers?: Record<string, string>) => call("POST", `/api/v1/public/records/${door}`, { values }, headers ?? { "x-adminium-proof": await proof() });

const visitor = (n: number | string) => ({ name: "Kit Alderman", email: `kit.${String(n)}@visitor-e2e.example`, body: "Six frames a year, each with a hand-painted decal. We would like a system." });

/** A create that must be made: through the key, with a proof. */
async function make(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const answer = await create(values);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  made += 1;
  return answer.body!["data"] as Record<string, unknown>;
}

const enquiries = () => stack.rows("enquiries");
const webCount = async () => (await enquiries()).filter((r) => r["source"] === "web").length;
/** The web enquiries this run added. */
const webMade = async () => (await webCount()) - webBefore;

// ── the browser ─────────────────────────────────────────────────────────────

/** The form, opened by its own address, as a visitor with no sign-in. */
async function openForm(browser: Browser, variant: Variant): Promise<Page> {
  const context = await newContext(browser, stack.server.base, variant);
  const page = await context.newPage();
  // The page's own writes spend the same minute as the script's.
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/public/records/")) wrote();
  });
  await page.goto(FORM);
  await expect(screenOf(page, "client-enquire")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#enquire-name")).toBeVisible();
  return page;
}

async function fill(page: Page, values: { name: string; email: string; body: string; business?: string; trade?: string; budget?: string; start_when?: string }): Promise<void> {
  await page.locator("#enquire-name").fill(values.name);
  await page.locator("#enquire-email").fill(values.email);
  if (values.business !== undefined) await page.locator("#enquire-business").fill(values.business);
  if (values.trade !== undefined) await page.locator("#enquire-trade").fill(values.trade);
  if (values.budget !== undefined) await page.locator("#enquire-budget").selectOption(values.budget);
  if (values.start_when !== undefined) await page.locator("#enquire-start-when").fill(values.start_when);
  await page.locator("#enquire-body").fill(values.body);
}

const send = (page: Page) => page.locator("[data-screen=client-enquire] button[type=submit]").click();
const words = (variant: Variant, key: Parameters<typeof say>[1], params?: Record<string, string | number>) => say(localeOf(variant), key, params);
const sentTitle = (variant: Variant) => words(variant, "enquire.sent.title", { studio: "Outline" });

/**
 * A state that holds a request open (the human check running): shot and swept
 * like every other, without waiting for the network to go quiet — it will
 * not until the test lets the request go.
 */
async function shootHeld(page: Page, name: string, variant: Variant): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${variant}.png`), fullPage: true });
  const result = await sweep(page);
  SWEEPS.set(`${engine}/${name}-${variant}`, result);
  expect.soft(result.passes, `axe analysed nothing on ${name} (${variant})`).toBeGreaterThan(0);
  expect.soft(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), `${name} (${variant})`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
  key = ((await (await fetch(`${stack.server.base}${PORTAL}surface-config.json`)).json()) as { publishableKey: string }).publishableKey;
  expect(key).toMatch(/^adm_pub_/);
  const refs = ((await call("GET", "/api/v1/public/config")).body!["data"] as { refs: Record<string, { actions: string[]; expose: string[]; writable: string[] }> }).refs;
  door = Object.entries(refs).find(([ref, r]) => ref.startsWith(stack.real["enquiries"]!) && r.actions.includes("create"))![0];
  webBefore = await webCount();
});

test.afterAll(async () => {
  await stack?.server.stop();
  // Every state was swept, and every sweep analysed something (a sweep of nothing passes by silence).
  const found = [...SWEEPS].filter(([name]) => name.startsWith(`${engine}/`));
  expect(found.length).toBeGreaterThan(0);
  for (const [name, result] of found) expect(result.passes, name).toBeGreaterThan(0);
});

test("the door: a create and nothing else, reading back only when it arrived", async () => {
  const refs = ((await call("GET", "/api/v1/public/config")).body!["data"] as { refs: Record<string, { actions: string[]; expose: string[]; writable: string[] }> }).refs;
  const onEnquiries = Object.entries(refs).filter(([ref]) => ref === stack.real["enquiries"] || ref.startsWith(`${stack.real["enquiries"]!}_`));
  expect(onEnquiries.map(([ref]) => ref)).toEqual([door]);
  expect(refs[door]).toMatchObject({ actions: ["create"], expose: ["received_at"] });
  expect([...refs[door]!.writable].sort()).toEqual(["body", "budget", "business", "email", "name", "start_when", "trade"]);
});

test("the form, empty and with its problems — nothing is sent until it is whole", async ({ browser }) => {
  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    const posts: Request[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r);
    });
    await expect(page.locator("h1")).toHaveText(words(variant, "screen.enquire"));
    await expect(page.locator("[data-screen=client-enquire] [role=status]")).toContainText(words(variant, "enquire.check"));
    await check(page, engine, "enquire-empty", variant);

    await send(page);
    await expect(page.locator("[aria-invalid=true]")).toHaveCount(3);
    await expect(page.locator("#enquire-name")).toBeFocused();
    for (const key of ["enquire.error.nameEmpty", "enquire.error.emailEmpty", "enquire.error.bodyEmpty"] as const) await expect(page.locator("main")).toContainText(words(variant, key));
    await check(page, engine, "enquire-errors", variant);

    // A name that is markup, and an address with no domain: said here, never sent.
    await fill(page, { name: "<img src=x onerror=alert(1)>", email: "rosa@", body: "A sign." });
    await send(page);
    await expect(page.locator("main")).toContainText(words(variant, "enquire.error.namePlain"));
    await expect(page.locator("main")).toContainText(words(variant, "enquire.error.emailShape"));
    expect(posts, "nothing is sent while the form has a problem").toEqual([]);
    await page.context().close();
  }
});

test("the human check is Adminium's own: the page solves its challenge and sends the proof; a script without one is refused", async ({ browser }) => {
  const before = await enquiries();
  const newBefore = before.filter((r) => r["status"] === "new").length;

  // Over the wire: no proof, a made-up one, one asked for a sign-in, one used twice.
  const noProof = await create(visitor("np"), {});
  expect(noProof.status).toBe(403);
  expect(noProof.code).toBe("PUBLIC_PROOF_REQUIRED");
  const madeUp = await create(visitor("mu"), { "x-adminium-proof": "eyJ2IjoxfQ~AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.0" });
  expect(madeUp.code).toBe("PUBLIC_PROOF_REQUIRED");
  const forClaim = await create(visitor("fc"), { "x-adminium-proof": await proof("claim") });
  expect(forClaim.code).toBe("PUBLIC_PROOF_REQUIRED");
  const once = await proof();
  const first = await create(visitor("once"), { "x-adminium-proof": once });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  made += 1;
  const again = await create(visitor("twice"), { "x-adminium-proof": once });
  expect(again.status).toBe(403);
  expect(again.code).toBe("PUBLIC_PROOF_REQUIRED");
  const emails = (await enquiries()).map((r) => r["email"]);
  for (const n of ["np", "mu", "fc", "twice"]) expect(emails, n).not.toContain(visitor(n).email);
  expect(emails).toContain(visitor("once").email);

  // In the browser: the check shown while it runs, then sent.
  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    const traffic: { url: string; method: string; proof: string | null; body: string | null }[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/public/challenge") || (r.method() === "POST" && r.url().includes("/api/v1/public/records/"))) {
        traffic.push({ url: r.url(), method: r.method(), proof: r.headers()["x-adminium-proof"] ?? null, body: r.postData() });
      }
    });
    // The challenge is held until the check has been seen and shot.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/v1/public/challenge**", async (route) => {
      await held;
      await route.continue();
    });
    const email = `amara.${variant}@visitor-e2e.example`;
    await fill(page, { name: "Amara Okafor", email, business: "Hearth & Loaf", trade: "Bakery", budget: "2to4k", start_when: "September", body: "A new name for the second shop, and the boxes to go with it." });
    // The band as the page says it: the studio's currency, the visitor's language.
    const band = (await page.locator("#enquire-budget option[value='2to4k']").innerText()).trim();
    expect(band).toContain("$");
    await room();
    await send(page);
    await expect(page.locator("[data-screen=client-enquire] [role=status]")).toContainText(words(variant, "enquire.checking"));
    await expect(page.locator("[data-screen=client-enquire] button[type=submit]")).toBeDisabled();
    await shootHeld(page, "enquire-checking", variant);
    const answered = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/v1/public/records/${door}`));
    release();
    const reply = await answered;
    expect(reply.status()).toBe(201);
    made += 1;
    // Nothing comes back but when it arrived.
    const replied = (await reply.json()) as { data: Record<string, unknown> };
    expect(Object.keys(replied)).toEqual(["data"]);
    expect(Object.keys(replied.data)).toEqual(["received_at"]);

    await expect(page.locator("[data-state=sent] h1")).toHaveText(sentTitle(variant), { timeout: 30_000 });
    await expect(page.locator("[data-state=sent] h1")).toBeFocused();
    const shown = await page.locator("main").innerText();
    for (const secret of ["ENQ-", email, "Amara", "Hearth"]) expect(shown, secret).not.toContain(secret);
    await check(page, engine, "enquire-sent", variant);

    // What the page sent: Adminium's challenge, then one create carrying its proof and the form's own fields.
    const challenge = traffic.find((t) => t.method === "GET")!;
    expect(challenge.url).toContain("purpose=write");
    const posts = traffic.filter((t) => t.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.proof).toMatch(/^[A-Za-z0-9_-]{16,400}~[A-Za-z0-9_-]{43}\.[0-9a-z]{1,32}$/);
    const values = (JSON.parse(posts[0]!.body!) as { values: Record<string, unknown> }).values;
    expect(Object.keys(values).sort()).toEqual(["body", "budget", "business", "email", "name", "start_when", "trade"]);
    expect(values).toMatchObject({ name: "Amara Okafor", email, budget: band });

    // On the desk: a new enquiry from the web, numbered and stamped by Adminium.
    const row = (await enquiries()).find((r) => r["email"] === email)!;
    expect(row).toMatchObject({ status: "new", source: "web", fit: null, client_id: null, proposal_id: null, name: "Amara Okafor", business: "Hearth & Loaf", trade: "Bakery", start_when: "September" });
    expect(row["number"]).toMatch(/^ENQ-\d{3}$/);
    expect(row["received_at"]).toBe(replied.data["received_at"]);
    await page.context().close();
  }
  const after = await enquiries();
  expect(after.length - before.length).toBe(1 + VARIANTS.length);
  expect(after.filter((r) => r["status"] === "new").length - newBefore).toBe(1 + VARIANTS.length);
});

test("a proof the server will not take is said in words, and nothing is made", async ({ browser }) => {
  const before = (await enquiries()).length;
  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    // The page is handed a challenge whose salt is not the one Adminium signed: its answer cannot hold.
    await page.route("**/api/v1/public/challenge**", async (route) => {
      // Asked again as the page asked it (a replayed request drops the page's origin, which the key checks).
      const response = await route.fetch({ headers: { ...route.request().headers(), origin: stack.server.base } });
      const body = (await response.json()) as { data: { salt: string } };
      if (body.data === undefined) throw new Error(`challenge answered ${String(response.status())}: ${JSON.stringify(body)}`);
      body.data.salt = `${body.data.salt}x`;
      await route.fulfill({ response, json: body });
    });
    await fill(page, { name: "Priya Raval", email: `priya.${variant}@visitor-e2e.example`, body: "A logo and signage for the new studio." });
    await room(2);
    await send(page);
    const alert = page.locator("[data-screen=client-enquire] [role=alert]");
    await expect(alert).toContainText(words(variant, "enquire.refused.check"), { timeout: 30_000 });
    await expect(alert.locator("a[href^='mailto:']")).toHaveCount(1);
    // What they wrote is still there to send again.
    await expect(page.locator("#enquire-body")).toHaveValue("A logo and signage for the new studio.");
    await check(page, engine, "enquire-check-refused", variant);
    await page.context().close();
  }
  expect((await enquiries()).length).toBe(before);
});

test("every column the studio decides is refused by the server, and nothing can be read, changed or removed", async () => {
  const before = (await enquiries()).length;
  for (const [column, value] of Object.entries(DECIDED_BY_THE_STUDIO)) {
    const forged = await create({ ...visitor(`forged-${column}`), [column]: value });
    expect(forged.status, `${column}: ${JSON.stringify(forged.body)}`).toBe(400);
    expect(forged.code, column).toBe("PUBLIC_WRITE_REFUSED");
    expect(forged.body!["data"], column).toBeUndefined();
  }
  // All of them at once, as a script would.
  const all = await create({ ...visitor("forged-all"), ...DECIDED_BY_THE_STUDIO });
  expect(all.code).toBe("PUBLIC_WRITE_REFUSED");
  // A column of another table, or none of any.
  expect((await create({ ...visitor("forged-other"), signed_name: "x" })).code).toBe("PUBLIC_WRITE_REFUSED");
  // Missing what the studio needs.
  const noBody = await create({ name: "Kit Alderman", email: "kit.nobody@visitor-e2e.example" });
  expect(noBody.code).toBe("PUBLIC_WRITE_REFUSED");
  expect(noBody.params["column"]).toBe("body");
  expect((await enquiries()).length).toBe(before);

  // Nothing to read back, nothing to change, nothing to remove — not even one's own.
  const own = (await enquiries()).find((r) => r["email"] === visitor("once").email)!;
  const list = await call("GET", `/api/v1/public/records/${door}`);
  const one = await call("GET", `/api/v1/public/records/${door}/${String(own.id)}`);
  const change = await call("PATCH", `/api/v1/public/records/${door}/${String(own.id)}`, { values: { status: "declined" } });
  const remove = await call("DELETE", `/api/v1/public/records/${door}/${String(own.id)}`);
  for (const [what, answer] of [["list", list], ["one", one], ["change", change], ["remove", remove]] as const) {
    expect(answer.status, what).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(answer.body ?? {}), what).not.toContain(visitor("once").email);
    expect(answer.body?.["data"], what).toBeUndefined();
  }
  const still = (await enquiries()).find((r) => r.id === own.id)!;
  expect(still).toMatchObject({ status: "new", source: "web", email: visitor("once").email });

  // A name that is not a plain name — markup, a link, a formula — is refused by the server too.
  for (const name of ["<img src=x onerror=alert(1)>", "Rosa http://evil.example", "www.evil.example", "=HYPERLINK(\"http://evil.example\")"]) {
    const refused = await create({ ...visitor(`name-${name.length}`), name });
    expect(refused.status, name).toBe(400);
    expect(refused.code, name).toBe("PUBLIC_WRITE_REFUSED");
    expect(refused.params["column"], name).toBe("name");
  }
  expect((await enquiries()).length).toBe(before);
});

test("markup in what they wrote reaches the desk and the studio's email as text; the email carries only its own words", async ({ browser }) => {
  const settings = (await stack.rows("settings"))[0]!;
  // The studio's switch as the sample ships it (off): an enquiry, and no email.
  const quiet = await make({ ...visitor("quiet"), business: "Quiet Co" });
  expect(quiet).toEqual({ received_at: expect.any(String) });
  // The studio turns "Tell us about new enquiries" on, with an address the outbox sends to.
  ok(await stack.staff.patch(`${stack.data("settings")}/${String(settings.id)}`, { values: { notify_enquiry: true, reply_to: STUDIO_MAIL } }));

  const hostile = {
    name: "Tess Ivory",
    email: "tess.hostile@visitor-e2e.example",
    business: `<img src=x onerror="window.__pwned=1">Tessellate Tiles`,
    trade: "TRADEMARK-Q7",
    budget: "4to8k",
    start_when: "STARTMARK-Q7",
    body: `<script>window.__pwned=2</script> <a href="https://evil.example/phish">Open your invoice</a> {{staff_url}} [click](https://evil.example/md)`,
  };
  const page = await openForm(browser, "light");
  await expect(page.locator("footer")).toContainText(STUDIO_MAIL);
  await fill(page, hostile);
  await room();
  await send(page);
  await expect(page.locator("[data-state=sent] h1")).toHaveText(sentTitle("light"), { timeout: 30_000 });
  made += 1;
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await page.context().close();

  const row = (await enquiries()).find((r) => r["email"] === hostile.email)!;
  expect(row).toMatchObject({ business: hostile.business, body: hostile.body, status: "new", source: "web" });

  // The studio is told — once, about this one, not about the one that came while the switch was off.
  const messages = await until(async () => {
    const all = await stack.rows("messages");
    return all.some((m) => m["kind"] === "new-enquiry" && m["enquiry_id"] === row.id) ? all : undefined;
  }, "the new-enquiry message");
  const notices = messages.filter((m) => m["kind"] === "new-enquiry");
  expect(notices.filter((m) => m["enquiry_id"] === row.id)).toHaveLength(1);
  const quietRow = (await enquiries()).find((r) => r["email"] === visitor("quiet").email)!;
  expect(notices.filter((m) => m["enquiry_id"] === quietRow.id)).toEqual([]);
  expect(["queued", "sent"]).toContain(notices.find((m) => m["enquiry_id"] === row.id)!["status"]);

  const mail = await until(async () => (await stack.mail()).find((m) => m.to.some((to) => to.includes(STUDIO_MAIL)) && m.subject.includes("Tess Ivory")), "the studio's email", 240_000);
  expect(mail.subject).toBe("A new enquiry from Tess Ivory");
  // What they wrote is quoted, as text: no markup of theirs becomes markup, no link of theirs a link.
  const html = mail.html ?? "";
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<img[^>]*src=["']?x/i);
  expect(html).not.toMatch(/href=["']https:\/\/evil\.example/i);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&lt;img src=x");
  expect(mail.text).toContain("<script>window.__pwned=2</script>");
  // A placeholder in what they wrote stays their words; it is never filled.
  expect(mail.text).toContain("{{staff_url}}");
  // Only what the email's words name: never the visitor's address or the facts it does not quote.
  for (const absent of [hostile.email, "TRADEMARK-Q7", "STARTMARK-Q7"]) {
    expect(mail.text, absent).not.toContain(absent);
    expect(html, absent).not.toContain(absent);
  }
  expect(mail.text).toContain(String(row["number"]));
  expect(mail.text).toContain(`${stack.server.base}/apps/clients/staff/enquiries`);

  // On the desk: the enquiry, in the inbox, its markup shown as the words it is.
  const context = await newContext(browser, stack.server.base, "light", stack.staff.cookies);
  const deskPage = await context.newPage();
  const desk = new Desk(deskPage, "light");
  await deskPage.goto(DESK);
  await desk.nav("enquiries");
  await desk.row("Tessellate Tiles", "enquiries");
  const main = deskPage.locator("main");
  await expect(main.locator("#enq-open")).toHaveText(hostile.business);
  await expect(main.locator(".enq-body")).toHaveText(hostile.body);
  await expect(main.locator("img")).toHaveCount(0);
  await expect(main.locator("script")).toHaveCount(0);
  await expect(main.locator("a[href*='evil.example']")).toHaveCount(0);
  expect(await deskPage.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  // The other visitors' enquiries are in the inbox too, unanswered.
  for (const business of ["Hearth & Loaf", "Quiet Co"]) await expect(main.locator(".enq-rows")).toContainText(business);
  await check(deskPage, engine, "desk-enquiry-from-the-web", "light");
  await context.close();
});

test("the limits: three a day from one address, thirty an hour through the page, too many at once — each in words, nothing made", async ({ browser }, info) => {
  info.setTimeout(1_200_000);
  // Three from one address …
  const address = "dominic.shaw@visitor-e2e.example";
  for (let i = 0; i < PER_ADDRESS; i += 1) await make({ ...visitor("x"), email: address, name: "Dominic Shaw" });
  // … and a fourth, however it is spelled, is refused.
  const fourth = await create({ ...visitor("x"), email: ` ${address.toUpperCase()} `, name: "Dominic Shaw" });
  expect(fourth.status).toBe(409);
  expect(fourth.code).toBe("PUBLIC_LIMIT_REACHED");
  const counted = (await enquiries()).filter((r) => String(r["email"]).toLowerCase() === address).length;
  expect(counted).toBe(PER_ADDRESS);

  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    await fill(page, { name: "Dominic Shaw", email: address, body: "Six partners, three offices, and an identity drawn in 1998." });
    await room();
    await send(page);
    const alert = page.locator("[data-screen=client-enquire] [role=alert]");
    await expect(alert).toContainText(words(variant, "enquire.refused.limit"), { timeout: 30_000 });
    await expect(alert.locator(`a[href="mailto:${STUDIO_MAIL}"]`)).toHaveCount(1);
    await check(page, engine, "enquire-limit-address", variant);
    await page.context().close();
  }
  expect((await enquiries()).filter((r) => String(r["email"]).toLowerCase() === address)).toHaveLength(PER_ADDRESS);

  // Too many at once from one connection: Adminium turns the next away for a minute.
  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    await fill(page, { name: "Priya Raval", email: `priya.busy.${variant}@visitor-e2e.example`, body: "We open in five weeks." });
    await room(WRITES_A_MINUTE - 1);
    for (let i = 0; i < WRITES_A_MINUTE; i += 1) {
      wrote();
      await fetch(`${stack.server.base}/api/v1/public/records/${door}`, { method: "POST", headers: { authorization: `Bearer ${key}`, origin: stack.server.base, "content-type": "application/json" }, body: JSON.stringify({ values: visitor("burst") }) });
    }
    const turnedAway = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/v1/public/records/${door}`));
    await send(page);
    expect((await turnedAway).status()).toBe(429);
    await expect(page.locator("[data-screen=client-enquire] [role=alert]")).toContainText(words(variant, "enquire.refused.busy"), { timeout: 30_000 });
    await expect(page.locator("#enquire-name")).toHaveValue("Priya Raval");
    await check(page, engine, "enquire-busy", variant);
    await page.context().close();
  }

  // Thirty an hour through the page's key, from any addresses at all.
  expect(await webMade()).toBe(made);
  for (let n = 0; made < PER_KEY_HOUR; n += 1) await make(visitor(`hour-${String(n)}`));
  const thirtyFirst = await create(visitor("hour-over"));
  expect(thirtyFirst.status).toBe(409);
  expect(thirtyFirst.code).toBe("PUBLIC_LIMIT_REACHED");
  for (const variant of VARIANTS) {
    const page = await openForm(browser, variant);
    // An address never used before: the page's hour is what is full.
    await fill(page, { name: "Growth Partners", email: `fresh.${variant}@visitor-e2e.example`, body: "We would like to talk." });
    await room();
    await send(page);
    await expect(page.locator("[data-screen=client-enquire] [role=alert]")).toContainText(words(variant, "enquire.refused.limit"), { timeout: 30_000 });
    await check(page, engine, "enquire-limit-page", variant);
    await page.context().close();
  }
  expect(await webMade()).toBe(PER_KEY_HOUR);
  const emails = (await enquiries()).map((r) => String(r["email"]));
  for (const variant of VARIANTS) {
    expect(emails).not.toContain(`fresh.${variant}@visitor-e2e.example`);
    expect(emails).not.toContain(`priya.busy.${variant}@visitor-e2e.example`);
  }
});
