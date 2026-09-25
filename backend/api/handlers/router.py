"""Minimal GET /me -- just enough for the header/greeting to render. The
rest of v1's account domain (PATCH /me, /me/email, /me/password, /me/export,
DELETE /me, pet_count/entry_count/date_of_birth/gender/nationality/age)
hasn't been ported to v2 yet.
"""

from fastapi import APIRouter, Depends

from auth.dependencies import AuthenticatedHandler, get_current_handler

from .schemas import MeOut

router = APIRouter(tags=["handlers"])


@router.get("/me", response_model=MeOut)
async def me(handler: AuthenticatedHandler = Depends(get_current_handler)) -> MeOut:
    return MeOut(id=handler.id, name=handler.name or "Handler", email=handler.email, joined_on=handler.joined_on)
