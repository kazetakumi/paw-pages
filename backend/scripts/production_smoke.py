"""Drive the whole app against the live Supabase project, over real HTTP.

Everything the test suite deliberately stubs — Supabase Auth, Supabase Storage,
the Admin API — is real here, which makes this the only thing that can catch a
defect in the seam between this app and Supabase. Migration 0003's five storage
policies denied everyone, always, and no unit or API test could have seen it.

    cd backend
    SMOKE_EMAIL=you+pawpages@example.com SMOKE_PASSWORD=... uv run python scripts/production_smoke.py

It creates one throwaway account, exercises every path through it, and deletes
that account at the end — which is also how the service-role path gets proved.
Nothing it touches outlives the run.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import sys
import zipfile
from datetime import date, timedelta

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://127.0.0.1:8000")
EMAIL = os.environ.get("SMOKE_EMAIL")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "smoke-test-password-9471")

# a 1x1 png, so the upload is a real image the bucket's mime check accepts
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

passed: list[str] = []
failed: list[tuple[str, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        passed.append(name)
        print(f"  PASS  {name}")
    else:
        failed.append((name, detail))
        print(f"  FAIL  {name}" + (f"\n        {detail}" if detail else ""))


async def main() -> int:
    if not EMAIL:
        print(
            "SMOKE_EMAIL is not set. Pass an address you control — this signs up\n"
            "a real account on the live project. Supabase's validator rejects\n"
            "example.com, so use a real domain or a +tag on your own address."
        )
        return 2

    async with httpx.AsyncClient(base_url=BASE, timeout=30.0, follow_redirects=False) as c:
        print("\n-- the session ------------------------------------------------")
        r = await c.get("/me")
        check("GET /me with no cookie is 401", r.status_code == 401, f"got {r.status_code}")

        # Attempting signup while Confirm email is on sends a real confirmation
        # email and still yields no session, so allow skipping it outright.
        if os.environ.get("SMOKE_SKIP_SIGNUP"):
            print("  SKIP  signup (SMOKE_SKIP_SIGNUP set; no confirmation email sent)")
            signed_up_through_the_app = False
        else:
            r = await c.post(
                "/auth/signup", json={"name": "Smoke Handler", "email": EMAIL, "password": PASSWORD}
            )
            signed_up_through_the_app = r.status_code == 201
            check("signup returns 201", signed_up_through_the_app, f"{r.status_code} {r.text[:200]}")

        if not signed_up_through_the_app:
            # Confirm email is still on, so Supabase answers signup with a user and
            # no session. Provision the account through the Admin API instead and
            # sign in, so the rest of the run still means something. The signup
            # path itself stays unproven — that is what the toggle is for.
            print("        (signup cannot return a session while Confirm email is on;")
            print("         provisioning through the Admin API and signing in instead)")
            key = os.environ.get("SMOKE_SERVICE_KEY", "")
            sb = os.environ.get("SMOKE_SUPABASE_URL", "")
            if not key or not sb:
                print("Set SMOKE_SERVICE_KEY and SMOKE_SUPABASE_URL to use the fallback.")
                return 1
            async with httpx.AsyncClient(base_url=sb, timeout=30) as admin:
                a = await admin.post(
                    "/auth/v1/admin/users",
                    headers={"apikey": key, "Authorization": f"Bearer {key}"},
                    json={
                        "email": EMAIL,
                        "password": PASSWORD,
                        "email_confirm": True,
                        "user_metadata": {"name": "Smoke Handler"},
                    },
                )
                if not a.is_success:
                    print(f"Admin provisioning failed: {a.status_code} {a.text[:300]}")
                    return 1
            r = await c.post("/auth/signin", json={"email": EMAIL, "password": PASSWORD})
            if r.status_code != 200:
                print(f"Sign in failed: {r.status_code} {r.text[:300]}")
                return 1
            check("sign in returns a session", True)

        cookie = r.headers.get("set-cookie", "")
        check("cookie is HttpOnly", "httponly" in cookie.lower(), cookie[:120])
        # Secure cookies are not sent back over plain http, so a local run has to
        # set COOKIE_SECURE=false. Only assert the flag when the base is https.
        if BASE.startswith("https://"):
            check("cookie is Secure", "secure" in cookie.lower(), cookie[:120])
        else:
            print("  SKIP  cookie is Secure (base is http; COOKIE_SECURE must be false locally)")
        check("cookie is SameSite=Lax", "samesite=lax" in cookie.lower(), cookie[:120])
        check("no token in the signup body", "access_token" not in r.text, r.text[:200])

        r = await c.get("/me")
        me = r.json()
        check(
            "the trigger made the handler row",
            r.status_code == 200 and me.get("name") == "Smoke Handler",
            f"{r.status_code} {r.text[:200]}",
        )

        print("\n-- a pet and an entry -----------------------------------------")
        r = await c.post("/pets", json={"name": "Smoke Biscuit", "species": "dog"})
        pet = r.json()
        pet_id, slug = pet.get("id"), pet.get("slug")
        check("a pet is created with a slug", r.status_code == 201 and bool(slug), r.text[:200])

        overdue_by = 46
        happened = date.today() - timedelta(days=400)
        due = date.today() - timedelta(days=overdue_by)
        r = await c.post(
            "/entries",
            json={
                "pet_id": pet_id,
                "title": "Rabies booster",
                "happened_on": happened.isoformat(),
                "due_on": due.isoformat(),
                "vet": "Northside Veterinary",
                "note": "batch 55-A, took it well",
                "closes_entry_id": None,
            },
        )
        check("an entry is created", r.status_code == 201, r.text[:200])

        r = await c.post(
            "/entries",
            json={
                "pet_id": pet_id,
                "title": "Impossible",
                "happened_on": (date.today() + timedelta(days=1)).isoformat(),
                "closes_entry_id": None,
            },
        )
        check("a future happened_on is a 422", r.status_code == 422, f"got {r.status_code}")

        print("\n-- the ledger, computed by Postgres ---------------------------")
        r = await c.get("/dashboard")
        dash = r.json()
        item = next((i for i in dash.get("ledger", []) if i.get("pet_id") == pet_id), None)
        check("the entry reaches the ledger", item is not None, json.dumps(dash)[:300])
        if item:
            check("it is flagged overdue by Postgres", item.get("is_overdue") is True, str(item))
            check(
                f"days_until is -{overdue_by}",
                item.get("days_until") == -overdue_by,
                f"got {item.get('days_until')}",
            )
        check("the overdue count is 1", dash.get("overdue") == 1, f"got {dash.get('overdue')}")
        check("one active pet", dash.get("active_pets") == 1, f"got {dash.get('active_pets')}")

        print("\n-- photos: the real test of migration 0004 --------------------")
        r = await c.put(f"/pets/{pet_id}/photo", content=PNG, headers={"content-type": "image/png"})
        check(
            "a photo uploads through the storage policies",
            r.status_code == 200,
            f"{r.status_code} {r.text[:300]}  <-- a 403 here means 0004 is wrong",
        )
        r = await c.get(f"/pets/{pet_id}/photo")
        check(
            "the owner's route serves the bytes back",
            r.status_code == 200 and r.content == PNG,
            f"{r.status_code} {len(r.content)} bytes",
        )

        print("\n-- the public page, as a visitor ------------------------------")
        r = await c.patch(f"/pets/{pet_id}", json={"is_public": True})
        check("the page switches on", r.status_code == 200, r.text[:200])

        async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as visitor:
            r = await visitor.get(f"/public/pets/{slug}")
            body = r.text
            check("a visitor with no cookie can read it", r.status_code == 200, body[:200])
            check("no note leaks", "took it well" not in body, body[:300])
            check("no vet leaks", "Northside" not in body, body[:300])
            check("no id leaks", str(pet_id) not in body, body[:300])
            r = await visitor.get(f"/public/pets/{slug}/photo")
            check(
                "the photo resolves as anon",
                r.status_code == 200 and r.content == PNG,
                f"{r.status_code}  <-- a 403 means the public storage policy is wrong",
            )

            await c.post(f"/pets/{pet_id}/archive", json={"reason": "rehomed"})
            r = await visitor.get(f"/public/pets/{slug}")
            check("archiving 404s the page", r.status_code == 404, f"got {r.status_code}")
            r = await visitor.get(f"/public/pets/{slug}/photo")
            check("archiving kills the photo too", r.status_code == 404, f"got {r.status_code}")

            await c.post(f"/pets/{pet_id}/restore")
            r = await visitor.get(f"/public/pets/{slug}")
            check("restoring puts it back", r.status_code == 200, f"got {r.status_code}")
            check(
                "the slug is unchanged",
                r.status_code == 200 and r.json().get("slug") == slug,
                "",
            )

        print("\n-- the export -------------------------------------------------")
        r = await c.get("/me/export")
        if r.status_code == 200:
            try:
                z = zipfile.ZipFile(io.BytesIO(r.content))
                names = z.namelist()
                blob = json.dumps(
                    json.loads(next(z.read(n) for n in names if n.endswith(".json")))
                )
                check("the archive holds the pet", "Smoke Biscuit" in blob, str(names)[:200])
                check("the archive holds the entry", "Rabies booster" in blob, str(names)[:200])
                check(
                    "the archive holds the photo",
                    any(n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) for n in names),
                    str(names)[:200],
                )
            except Exception as error:  # noqa: BLE001 — report, do not raise
                check("the export opens as a zip", False, f"{type(error).__name__}: {error}")
        else:
            check("the export returns 200", False, f"{r.status_code} {r.text[:200]}")

        print("\n-- deletion: the only use of the service-role key --------------")
        r = await c.delete("/me")
        if r.status_code == 503:
            check("DELETE /me", False, "503 — SUPABASE_SERVICE_ROLE_KEY is not set")
        else:
            check("the account deletes", r.status_code == 204, f"{r.status_code} {r.text[:200]}")
            r = await c.get("/me")
            check("the session is gone", r.status_code == 401, f"got {r.status_code}")
            r = await c.post("/auth/signin", json={"email": EMAIL, "password": PASSWORD})
            check("the account cannot sign back in", r.status_code == 401, f"got {r.status_code}")

    print("\n" + "=" * 64)
    print(f"{len(passed)} passed, {len(failed)} failed")
    for name, detail in failed:
        print(f"  FAIL  {name}\n        {detail}")
    if failed:
        print(
            "\nThe account may still exist on the project — check auth.users and\n"
            "delete it by hand if the run stopped before DELETE /me."
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
