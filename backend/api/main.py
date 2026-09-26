import logging
import time

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth.router import router as auth_router
from conversations.router import router as conversations_router
from core.config import get_settings
from handlers.router import router as handlers_router
from core.logging import configure_logging
from db.pool import close_pool, init_pool
from pets.router import router as pets_router
from uploads.router import router as uploads_router

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title="Paw Pages API")

# credentials=True + an explicit origin (not "*") is required for the
# session cookie to travel with cross-origin fetches from the frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %s (%.1fms)", request.method, request.url.path, response.status_code, duration_ms
    )
    return response


@app.exception_handler(RequestValidationError)
async def one_field_at_a_time(request: Request, exc: RequestValidationError) -> JSONResponse:
    """A rejected field as {field, message} -- what the web app's FieldError
    reads to show it beside the input -- not pydantic's list of loc/msg."""
    first = exc.errors()[0]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": {"field": str(first["loc"][-1]), "message": first["msg"]}},
    )


@app.exception_handler(Exception)
async def log_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


app.include_router(auth_router)
app.include_router(conversations_router)
app.include_router(handlers_router)
app.include_router(pets_router)
app.include_router(uploads_router)


@app.on_event("startup")
async def startup() -> None:
    await init_pool()
    logger.info("Paw Pages API starting up (environment=%s)", settings.environment)


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_pool()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
