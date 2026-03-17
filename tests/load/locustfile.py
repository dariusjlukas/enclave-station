"""Locust entry point — imports all scenario user classes.

Run a specific scenario:
    locust --host=http://localhost:9001 AuthLoadUser
    locust --host=http://localhost:9001 MessagingUser

Run all scenarios (Locust picks from all user classes):
    locust --host=http://localhost:9001

Use --class-picker in the web UI to select interactively.
"""

from scenarios.auth_load import AuthLoadUser
from scenarios.messaging import MessagingUser
from scenarios.rest_api_mix import RestApiMixUser
from scenarios.file_upload import FileUploadUser
from scenarios.search import SearchUser
from scenarios.mixed_realistic import RealisticUser

__all__ = [
    "AuthLoadUser",
    "MessagingUser",
    "RestApiMixUser",
    "FileUploadUser",
    "SearchUser",
    "RealisticUser",
]
