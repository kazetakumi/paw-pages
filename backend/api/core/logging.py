"""One-line setup for stdout logging, shared by every module in the API."""

from __future__ import annotations

import logging
import sys


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
        force=True,
    )
    # httpx logs every request at INFO by default, which drowns out our own
    # logs -- we log the outcomes we care about ourselves in auth/gotrue.py.
    logging.getLogger("httpx").setLevel(logging.WARNING)
