# The Adminium public API

What a browser page may do against an Adminium instance. Written from the implementation,
not from a spec.

## Getting to it

Two headers, and one of them is optional:

```
Authorization: Bearer adm_pub_…                 always
x-adminium-public-session: adm_pubs_…           only after a claim
```

The publishable key ships **in your JavaScript**. That is expected and safe by design: a key
can only ever do what its scope allows, and it is inert on every other route in the product —
present it to the admin API and you get a 401.

The base URL and key arrive as build-time environment variables. Under Vite only
`VITE_`-prefixed names reach browser code:

```
VITE_ADMINIUM_API_BASE_URL=https://admin.example.com
VITE_ADMINIUM_PUBLISHABLE_KEY=adm_pub_…
```

**Both absent means demo mode.** That is one condition, not two, and it is how the hosted
marketplace demos keep working with no server behind them. Do not add a second flag.

## Endpoints

| | |
|---|---|
| `GET /api/v1/public/config` | What this key may do. No rows. Fetch it once at boot. |
| `GET /api/v1/public/records/:ref` | List. |
| `GET /api/v1/public/records/:ref/:id` | One row. |
| `POST /api/v1/public/records/:ref` | Create. |
| `PATCH /api/v1/public/records/:ref/:id` | Update. |
| `POST /api/v1/public/claim` | Prove who you are; get a session. |
| `DELETE /api/v1/public/session` | Sign out. |

`:ref` is a **logical** name the operator chose (`menu`, `appointments`) — never a table name.

### `/config` is worth reading properly

It carries the **tenant's time zone**, and you must build every date and time from it:

```json
{ "data": { "version": 1, "side": "customer", "timezone": "Europe/London",
            "claim": { "strategy": "lookup", "ref": "patients", "match": ["phone", "born_on"] },
            "refs": { "menu": { "actions": ["read"], "expose": ["id","name","price"],
                                "filterable": [], "searchable": ["name"],
                                "orderable": ["name"], "writable": [], "limit": 100 } } } }
```

**Never `new Date(value).getHours()` on an API timestamp.** That reads the *visitor's* clock,
not the business's. A booking made at 15:00 in London renders at 16:00 for a visitor in
Berlin and nothing errors. Use the `timezone` from `/config`.

## Querying

Query parameters follow the dashboard's list DSL, narrowed:

- `where` — JSON filter. Only columns in `filterable`. **Defaults to empty**, so most
  resources accept no filter at all until the operator opens one.
- `q` — substring search. Only columns in `searchable`. Absent list ⇒ refused.
- `order` — only columns in `orderable`.
- `limit` / `offset` / `cursor` — `limit` is capped by the scope.
- `select` — **accepted and ignored.** The scope's `expose` list is the complete column set.
- `count` — not available. Totals come back `null`. Use `cursor` for "load more".

Whatever you send, the scope's own filter is applied first and cannot be removed.

## Writes

```jsonc
POST /api/v1/public/records/enquiries
{ "values": { "subject": "Repeat prescription", "body": "…" } }
```

Only columns in `writable`. A column outside it is a **refusal**, not a silent drop — so a
page cannot half-succeed. Three kinds of value are set by the server and are not yours:

- anything in the scope's `defaults`;
- the column that ties the row to the claimed visitor;
- anything the scope's filter constrains.

A create returns only the `expose` columns — never more than a read of the same row would.

## Claims — knowing who the visitor is

A claim is an identity check, not a login. There is no account and no password.

```jsonc
POST /api/v1/public/claim
{ "match": { "phone": "07700 900401", "born_on": "1987-03-14" } }
→ { "data": { "session": "adm_pubs_…", "expiresAt": 1787240000000 } }
```

Send **exactly** the columns `config.claim.match` lists — every one, and nothing else. One
missing factor or one extra field is a refusal.

Then send the session header on every request. Resources the operator marked as belonging to
someone become **visible and filtered to that person**; without the session they are not
merely unfiltered, they **do not exist** — a 404 identical to a ref that was never declared.

Every claim failure returns the same `PUBLIC_CLAIM_NO_MATCH`. Do not tell the visitor which
factor was wrong; you cannot, and the server will not tell you either. That is deliberate:
anything finer turns a two-factor check into two one-factor ones.

**The honest limit.** In the `lookup` tier, knowing the reference *is* the credential. It is
right for "track my order" and wrong for a medical record — for sensitive data the operator
must configure an email code instead, and the server refuses to start a scope that gets this
wrong.

## Errors

The wire carries **codes, never prose**. `message` is for a developer reading a network tab;
render your own copy from the code, in your own locale files.

| Code | Means |
|---|---|
| `PUBLIC_API_DISABLED` | The operator turned the surface off. Fall back to demo data. |
| `PUBLIC_KEY_INVALID` | No key, wrong key, revoked, expired. |
| `PUBLIC_ORIGIN_REFUSED` | This origin is not on the allow-list. |
| `PUBLIC_REF_NOT_FOUND` | No such resource, or not for this action, or it needs a claim. |
| `PUBLIC_QUERY_REFUSED` | A filter, sort or search the scope does not permit. |
| `PUBLIC_WRITE_REFUSED` | A column that is not writable, or the database refused the row. |
| `PUBLIC_CLAIM_NO_MATCH` | The claim did not identify exactly one person. |
| `PUBLIC_CLAIM_UNAVAILABLE` | This key has no claim configured. |
| `PUBLIC_RATE_LIMITED` | Too fast. `Retry-After` says how long. |
| `PUBLIC_UPSTREAM_UNAVAILABLE` | The instance cannot serve this right now. |

Several of these are deliberately indistinguishable from one another. Do not build UI that
tries to tell them apart.

## Rate limits

120 reads, 20 writes and **5 claims** per minute. The claim limit is the tightest thing in
the product because it is what stands between a guessable reference and someone walking the
whole space. Do not retry a claim in a loop.
