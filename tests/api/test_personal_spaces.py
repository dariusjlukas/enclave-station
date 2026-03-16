"""Tests for the personal spaces feature: admin settings, auto-creation,
guards, tool sync, and shared-with-me endpoint."""

import pytest
from conftest import auth_header, pki_register


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def enable_personal_spaces(client, admin_headers):
    r = client.put('/api/admin/settings',
        json={'personal_spaces_enabled': True},
        headers=admin_headers)
    assert r.status_code == 200


def get_personal_space(client, user_headers):
    r = client.get('/api/spaces', headers=user_headers)
    assert r.status_code == 200
    spaces = r.json()
    for s in spaces:
        if s.get('is_personal'):
            return s
    return None


# ---------------------------------------------------------------------------
# Admin settings for personal spaces
# ---------------------------------------------------------------------------
class TestPersonalSpacesAdmin:
    def test_personal_spaces_settings_default_disabled(self, client, admin_user):
        """GET /api/admin/settings returns personal_spaces_enabled: false by default."""
        r = client.get('/api/admin/settings', headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data.get('personal_spaces_enabled') is False

    def test_enable_personal_spaces(self, client, admin_user):
        """PUT /api/admin/settings with personal_spaces_enabled: true succeeds."""
        r = client.put('/api/admin/settings',
                       json={'personal_spaces_enabled': True},
                       headers=admin_user["headers"])
        assert r.status_code == 200
        # Verify it persists
        r = client.get('/api/admin/settings', headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()['personal_spaces_enabled'] is True

    def test_toggle_individual_tools(self, client, admin_user):
        """Disable files tool, verify it persists in settings."""
        r = client.put('/api/admin/settings',
                       json={
                           'personal_spaces_enabled': True,
                           'personal_spaces_files_enabled': False,
                           'personal_spaces_calendar_enabled': True,
                           'personal_spaces_tasks_enabled': True,
                           'personal_spaces_wiki_enabled': True,
                       },
                       headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get('/api/admin/settings', headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data['personal_spaces_files_enabled'] is False
        assert data['personal_spaces_calendar_enabled'] is True
        assert data['personal_spaces_tasks_enabled'] is True
        assert data['personal_spaces_wiki_enabled'] is True

    def test_set_storage_limit(self, client, admin_user):
        """Set personal_spaces_storage_limit to 50MB (52428800 bytes)."""
        r = client.put('/api/admin/settings',
                       json={
                           'personal_spaces_enabled': True,
                           'personal_spaces_storage_limit': 52428800,
                       },
                       headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get('/api/admin/settings', headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()['personal_spaces_storage_limit'] == 52428800


# ---------------------------------------------------------------------------
# Auto-creation of personal spaces
# ---------------------------------------------------------------------------
class TestPersonalSpaceCreation:
    def test_personal_space_auto_created(self, client, admin_user, regular_user):
        """Enable feature, GET /api/spaces as regular user, verify is_personal space exists."""
        enable_personal_spaces(client, admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        assert ps['is_personal'] is True

    def test_personal_space_not_created_when_disabled(self, client, admin_user, regular_user):
        """Feature disabled, GET /api/spaces should have no personal space."""
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is None

    def test_personal_space_hidden_when_disabled(self, client, admin_user, regular_user):
        """Enable (created), disable (hidden), re-enable (reappears with same id)."""
        # Enable and get personal space
        enable_personal_spaces(client, admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        original_id = ps['id']

        # Disable personal spaces
        r = client.put('/api/admin/settings',
                       json={'personal_spaces_enabled': False},
                       headers=admin_user["headers"])
        assert r.status_code == 200

        # Personal space should be hidden
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is None

        # Re-enable — same space should reappear
        enable_personal_spaces(client, admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        assert ps['id'] == original_id

    def test_one_personal_space_per_user(self, client, admin_user, regular_user):
        """Multiple GET /api/spaces calls return the same personal space id."""
        enable_personal_spaces(client, admin_user["headers"])
        ps1 = get_personal_space(client, regular_user["headers"])
        ps2 = get_personal_space(client, regular_user["headers"])
        ps3 = get_personal_space(client, regular_user["headers"])
        assert ps1 is not None
        assert ps1['id'] == ps2['id'] == ps3['id']


# ---------------------------------------------------------------------------
# Guards: operations disallowed on personal spaces
# ---------------------------------------------------------------------------
class TestPersonalSpaceGuards:
    @pytest.fixture(autouse=True)
    def _setup_personal_space(self, client, admin_user, regular_user):
        """Enable personal spaces and store the personal space id for guard tests."""
        enable_personal_spaces(client, admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        self.ps_id = ps['id']

    def test_cannot_create_channel_in_personal_space(self, client, regular_user):
        """POST /api/spaces/:id/channels returns 400 for personal spaces."""
        r = client.post(f'/api/spaces/{self.ps_id}/channels',
                        json={'name': 'extra'},
                        headers=regular_user["headers"])
        assert r.status_code == 400

    def test_cannot_leave_personal_space(self, client, regular_user):
        """POST /api/spaces/:id/leave returns 400 for personal spaces."""
        r = client.post(f'/api/spaces/{self.ps_id}/leave',
                        headers=regular_user["headers"])
        assert r.status_code == 400

    def test_cannot_archive_personal_space(self, client, regular_user):
        """POST /api/spaces/:id/archive returns 400 for personal spaces."""
        r = client.post(f'/api/spaces/{self.ps_id}/archive',
                        headers=regular_user["headers"])
        assert r.status_code == 400

    def test_cannot_invite_to_personal_space(self, client, admin_user, regular_user):
        """POST /api/spaces/:id/members returns 400 for personal spaces."""
        r = client.post(f'/api/spaces/{self.ps_id}/members',
                        json={'user_id': admin_user['user']['id']},
                        headers=regular_user["headers"])
        assert r.status_code == 400

    def test_owner_can_toggle_tools(self, client, regular_user):
        """Personal space owner can disable and re-enable tools."""
        # Disable files
        r = client.put(f'/api/spaces/{self.ps_id}/tools',
                       json={'tool': 'files', 'enabled': False},
                       headers=regular_user["headers"])
        assert r.status_code == 200
        assert 'files' not in r.json()['enabled_tools']
        # Re-enable files
        r = client.put(f'/api/spaces/{self.ps_id}/tools',
                       json={'tool': 'files', 'enabled': True},
                       headers=regular_user["headers"])
        assert r.status_code == 200
        assert 'files' in r.json()['enabled_tools']

    def test_cannot_enable_admin_disallowed_tool(self, client, admin_user, regular_user):
        """Cannot enable a tool the admin has disallowed."""
        # Admin disallows wiki
        client.put('/api/admin/settings',
                   json={'personal_spaces_wiki_enabled': False},
                   headers=admin_user["headers"])
        # User tries to enable wiki
        r = client.put(f'/api/spaces/{self.ps_id}/tools',
                       json={'tool': 'wiki', 'enabled': True},
                       headers=regular_user["headers"])
        assert r.status_code == 400

    def test_personal_space_not_in_public_listing(self, client, admin_user, regular_user):
        """GET /api/spaces/public does not include personal spaces."""
        r = client.get('/api/spaces/public', headers=admin_user["headers"])
        assert r.status_code == 200
        for s in r.json():
            assert s.get('is_personal') is not True


# ---------------------------------------------------------------------------
# Tool sync between admin settings and personal spaces
# ---------------------------------------------------------------------------
class TestPersonalSpaceTools:
    def test_all_allowed_tools_auto_enabled(self, client, admin_user, regular_user):
        """Enable all tools, verify personal space has all 4 in enabled_tools."""
        client.put('/api/admin/settings',
                   json={
                       'personal_spaces_enabled': True,
                       'personal_spaces_files_enabled': True,
                       'personal_spaces_calendar_enabled': True,
                       'personal_spaces_tasks_enabled': True,
                       'personal_spaces_wiki_enabled': True,
                   },
                   headers=admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        enabled = set(ps.get('enabled_tools', []))
        assert {'files', 'calendar', 'tasks', 'wiki'} <= enabled

    def test_disabled_tool_not_in_personal_space(self, client, admin_user, regular_user):
        """Disable wiki, verify it is not in enabled_tools."""
        client.put('/api/admin/settings',
                   json={
                       'personal_spaces_enabled': True,
                       'personal_spaces_files_enabled': True,
                       'personal_spaces_calendar_enabled': True,
                       'personal_spaces_tasks_enabled': True,
                       'personal_spaces_wiki_enabled': False,
                   },
                   headers=admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        enabled = set(ps.get('enabled_tools', []))
        assert 'wiki' not in enabled
        assert 'files' in enabled

    def test_tool_sync_on_settings_change(self, client, admin_user, regular_user):
        """Enable all, then disable calendar, verify calendar removed from personal space."""
        # First enable all tools
        client.put('/api/admin/settings',
                   json={
                       'personal_spaces_enabled': True,
                       'personal_spaces_files_enabled': True,
                       'personal_spaces_calendar_enabled': True,
                       'personal_spaces_tasks_enabled': True,
                       'personal_spaces_wiki_enabled': True,
                   },
                   headers=admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        assert 'calendar' in ps.get('enabled_tools', [])

        # Now disable calendar
        client.put('/api/admin/settings',
                   json={
                       'personal_spaces_calendar_enabled': False,
                   },
                   headers=admin_user["headers"])
        ps = get_personal_space(client, regular_user["headers"])
        assert ps is not None
        enabled = set(ps.get('enabled_tools', []))
        assert 'calendar' not in enabled
        assert 'files' in enabled
        assert 'wiki' in enabled


# ---------------------------------------------------------------------------
# Shared-with-me endpoint
# ---------------------------------------------------------------------------
class TestSharedWithMe:
    def test_shared_with_me_empty(self, client, admin_user, regular_user):
        """GET /api/shared-with-me returns empty arrays for a fresh user."""
        r = client.get('/api/shared-with-me', headers=regular_user["headers"])
        assert r.status_code == 200
        data = r.json()
        # Should be an object with empty arrays
        assert isinstance(data, dict)
        for key, val in data.items():
            assert isinstance(val, list)
            assert len(val) == 0
