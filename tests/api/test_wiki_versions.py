"""Tests for wiki page versioning behavior.

Verifies that versions are only created when content actually changes,
and that the version history accurately reflects page edits.
"""


def _create_space_with_wiki(client, headers):
    """Create a space and enable the wiki tool. Return space id."""
    r = client.post("/api/spaces", json={"name": "WikiSpace"}, headers=headers)
    assert r.status_code == 200
    space_id = r.json()["id"]
    r = client.put(
        f"/api/spaces/{space_id}/tools",
        json={"tool": "wiki", "enabled": True},
        headers=headers,
    )
    assert r.status_code == 200
    return space_id


def _create_page(client, space_id, title, content, headers):
    """Create a wiki page and return its id."""
    r = client.post(
        f"/api/spaces/{space_id}/wiki/pages",
        json={"title": title, "content": content},
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()["id"]


def _get_versions(client, space_id, page_id, headers):
    """Fetch version history for a page."""
    r = client.get(
        f"/api/spaces/{space_id}/wiki/pages/{page_id}/versions",
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()["versions"]


def _update_page(client, space_id, page_id, updates, headers):
    """Update a wiki page."""
    r = client.put(
        f"/api/spaces/{space_id}/wiki/pages/{page_id}",
        json=updates,
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()


class TestWikiVersionCreation:
    def test_initial_version_created_on_page_creation(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Getting Started", "Hello world", admin_user["headers"]
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 1
        assert versions[0]["version_number"] == 1
        assert versions[0]["title"] == "Getting Started"

    def test_version_created_when_content_changes(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Guide", "Original content", admin_user["headers"]
        )

        # Edit the content (simulates auto-save)
        _update_page(
            client, space_id, page_id,
            {"content": "Updated content"},
            admin_user["headers"],
        )

        # Request version creation (simulates clicking View)
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 2
        assert versions[0]["version_number"] == 2

    def test_no_version_created_when_content_unchanged(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Static Page", "Same content", admin_user["headers"]
        )

        # Request version creation without changing anything
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 1  # Still only the initial version

    def test_repeated_create_version_without_changes(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Stable Page", "No edits", admin_user["headers"]
        )

        # Click View multiple times without editing
        for _ in range(3):
            _update_page(
                client, space_id, page_id,
                {"create_version": True},
                admin_user["headers"],
            )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 1  # No spurious versions

    def test_version_created_when_title_changes(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Old Title", "Some content", admin_user["headers"]
        )

        # Change title
        _update_page(
            client, space_id, page_id,
            {"title": "New Title"},
            admin_user["headers"],
        )

        # Request version creation
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 2

    def test_version_after_change_then_no_version_without_change(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Page", "v1 content", admin_user["headers"]
        )

        # Edit and create version
        _update_page(
            client, space_id, page_id,
            {"content": "v2 content"},
            admin_user["headers"],
        )
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 2

        # Now request version again without changes — should not create v3
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 2  # Still 2

    def test_multiple_edits_create_multiple_versions(self, client, admin_user):
        space_id = _create_space_with_wiki(client, admin_user["headers"])
        page_id = _create_page(
            client, space_id, "Evolving", "draft 1", admin_user["headers"]
        )

        # First edit cycle
        _update_page(
            client, space_id, page_id,
            {"content": "draft 2"},
            admin_user["headers"],
        )
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        # Second edit cycle
        _update_page(
            client, space_id, page_id,
            {"content": "draft 3"},
            admin_user["headers"],
        )
        _update_page(
            client, space_id, page_id,
            {"create_version": True},
            admin_user["headers"],
        )

        versions = _get_versions(client, space_id, page_id, admin_user["headers"])
        assert len(versions) == 3
        assert versions[0]["version_number"] == 3
        assert versions[1]["version_number"] == 2
        assert versions[2]["version_number"] == 1
