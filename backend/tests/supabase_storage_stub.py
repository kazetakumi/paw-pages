"""Supabase Storage, stubbed at the HTTP boundary.

The second external service the API tests stub, and stubbed the same way as
Supabase Auth: at the httpx transport, standing in for the thing itself. It
really holds the bytes, so `objects` is what a test asserts against to prove an
upload landed, a replacement left nothing behind, and a removal really deleted.

It also records the bearer token every call carried, which is how a test shows
the owner's route reads as the handler and the visitor's route reads as `anon`.

Nothing about the database is stubbed. Which pet a photo belongs to, whether
the caller owns it and whether a visitor may see it are all decided by real
rows, real RLS and the real `pawpages_public_pets` view on the backend's own
connection, before a single byte is asked for here.
"""

import httpx

PREFIX = "/storage/v1/object/"


class SupabaseStorageStub(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        # path -> (content type, bytes), exactly what the bucket would hold.
        self.objects: dict[str, tuple[str, bytes]] = {}
        # (method, path, bearer) for every call made, oldest first.
        self.calls: list[tuple[str, str, str]] = []

    def reset(self) -> None:
        self.objects.clear()
        self.calls.clear()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not request.url.path.startswith(PREFIX):
            raise AssertionError(f"unexpected Supabase Storage call: {request.url}")
        bucket, _, path = request.url.path[len(PREFIX) :].partition("/")
        if bucket != "pet-photos":
            raise AssertionError(f"unexpected bucket: {bucket}")
        bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
        self.calls.append((request.method, path, bearer))

        if request.method == "POST":
            if path in self.objects:
                return httpx.Response(409, json={"message": "The resource already exists"})
            self.objects[path] = (
                request.headers.get("content-type", "application/octet-stream"),
                request.content,
            )
            return httpx.Response(200, json={"Key": f"{bucket}/{path}"})

        if request.method == "GET":
            if path not in self.objects:
                return httpx.Response(404, json={"message": "Object not found"})
            content_type, content = self.objects[path]
            return httpx.Response(200, content=content, headers={"content-type": content_type})

        if request.method == "DELETE":
            if self.objects.pop(path, None) is None:
                return httpx.Response(404, json={"message": "Object not found"})
            return httpx.Response(200, json={"message": "Successfully deleted"})

        raise AssertionError(f"unexpected Supabase Storage call: {request.url}")
