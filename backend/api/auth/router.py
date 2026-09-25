import logging

from fastapi import APIRouter, HTTPException, Request, Response, status

from core.config import get_settings
from core.crypto import SessionCookieError, open_session

from . import gotrue
from .cookies import clear_session_cookie, set_session_cookie
from .schemas import (
    HandlerOut,
    MessageResponse,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    SignInRequest,
    SignUpRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _handler_out(payload: dict) -> HandlerOut:
    metadata = payload.get("user_metadata") or {}
    return HandlerOut(
        id=payload["id"],
        name=metadata.get("name") or "Handler",
        email=payload["email"],
        joined_on=(payload.get("created_at") or "")[:10],
    )


@router.post("/signup", response_model=HandlerOut | MessageResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignUpRequest, response: Response) -> HandlerOut | MessageResponse:
    try:
        session = await gotrue.sign_up(body.email, body.password, body.name)
    except gotrue.GoTrueError as exc:
        logger.warning("Signup failed for %s: %s", body.email, exc.message)
        raise HTTPException(exc.status_code, exc.message) from exc

    # With email confirmation disabled (e.g. local dev), Supabase auto-confirms
    # the account and hands back a full session right away -- log the handler
    # straight in instead of telling them to check an email that never comes.
    if "access_token" in session:
        set_session_cookie(response, session["access_token"], session["refresh_token"])
        logger.info("Signup auto-confirmed and signed in %s", body.email)
        return _handler_out(session["user"])

    logger.info("Signup requested for %s", body.email)
    # Deliberately the same message whether or not the email was already
    # registered -- Supabase itself avoids confirming that in its response,
    # and we don't want to undo that here.
    return MessageResponse(message="Check your email to confirm your account before signing in.")


@router.post("/signin", response_model=HandlerOut)
async def signin(body: SignInRequest, response: Response) -> HandlerOut:
    try:
        session = await gotrue.sign_in_with_password(body.email, body.password)
    except gotrue.GoTrueError as exc:
        logger.warning("Sign-in failed for %s: %s", body.email, exc.message)
        raise HTTPException(exc.status_code, exc.message) from exc

    set_session_cookie(response, session["access_token"], session["refresh_token"])
    logger.info("Sign-in succeeded for %s", body.email)
    return _handler_out(session["user"])


@router.post("/signout", response_model=MessageResponse)
async def signout(request: Request, response: Response) -> MessageResponse:
    settings = get_settings()
    sealed = request.cookies.get(settings.cookie_name)
    if sealed:
        try:
            access_token, _ = open_session(sealed)
            await gotrue.sign_out(access_token)
        except (SessionCookieError, gotrue.GoTrueError) as exc:
            logger.warning("Best-effort session revoke failed during sign-out: %s", exc)
    clear_session_cookie(response)
    return MessageResponse(message="Signed out.")


@router.post("/password-reset", response_model=MessageResponse)
async def password_reset(body: PasswordResetRequest) -> MessageResponse:
    settings = get_settings()
    redirect_to = f"{settings.frontend_url.rstrip('/')}/reset-password"
    try:
        await gotrue.send_password_recovery(body.email, redirect_to)
    except gotrue.GoTrueError as exc:
        # Logged for diagnosis only -- the response below never reveals
        # whether the email has an account, regardless of outcome.
        logger.info("Password recovery request for %s failed upstream: %s", body.email, exc.message)
    return MessageResponse(message="If that email has an account, a reset link is on its way.")


@router.post("/password-reset/confirm", response_model=MessageResponse)
async def password_reset_confirm(body: PasswordResetConfirmRequest) -> MessageResponse:
    # access_token comes straight from Supabase's recovery link (the frontend
    # never round-trips a token_hash through us) -- no refresh_token travels
    # with it, so this does not sign the handler in; they sign in normally
    # afterward.
    try:
        updated = await gotrue.update_password(body.access_token, body.password)
    except gotrue.GoTrueError as exc:
        logger.warning("Password reset confirmation failed: %s", exc.message)
        raise HTTPException(exc.status_code, exc.message) from exc

    logger.info("Password reset succeeded for %s", updated.get("email"))
    return MessageResponse(message="Password updated.")
