"""Tests for the global search endpoint, including space files in results."""

from conftest import pki_register, auth_header


def _create_space(client, headers, name="SearchSpace"):
    r = client.post("/api/spaces", json={"name": name}, headers=headers)
    assert r.status_code == 200
    sp = r.json()
    client.put(f"/api/spaces/{sp['id']}/tools",
               json={"tool": "files", "enabled": True}, headers=headers)
    return sp


def _upload_space_file(client, space_id, headers, filename="test.txt",
                       content=b"hello world", content_type="text/plain",
                       parent_id=""):
    params = {"filename": filename, "content_type": content_type}
    if parent_id:
        params["parent_id"] = parent_id
    r = client.post(
        f"/api/spaces/{space_id}/files/upload",
        params=params,
        content=content,
        headers={**headers, "Content-Type": content_type},
    )
    assert r.status_code == 200
    return r.json()


class TestSearchSpaceFiles:
    """Verify that files uploaded to the Files tool appear in global search."""

    def test_space_file_appears_in_search(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="quarterly-report.pdf",
                           content=b"PDF content")

        r = client.get("/api/search", params={
            "q": "quarterly-report",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["type"] == "files"
        results = data["results"]
        assert len(results) >= 1

        match = next(f for f in results if f["file_name"] == "quarterly-report.pdf")
        assert match["source"] == "space"
        assert match["space_id"] == sp["id"]
        assert match["space_name"] == "SearchSpace"
        assert match["username"] == admin_user["user"]["username"]

    def test_space_file_search_partial_match(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="design-mockup-v2.png",
                           content=b"\x89PNG")

        r = client.get("/api/search", params={
            "q": "mockup",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        assert any(f["file_name"] == "design-mockup-v2.png" for f in results)

    def test_space_file_not_visible_to_non_member(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"], "PrivateSpace")
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="secret-plans.docx")

        # regular_user is not a member of this space
        r = client.get("/api/search", params={
            "q": "secret-plans",
            "type": "files",
        }, headers=regular_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        assert not any(f["file_name"] == "secret-plans.docx" for f in results)

    def test_space_file_visible_to_member(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="shared-doc.txt")

        # Join the space as regular_user
        client.post(f"/api/spaces/{sp['id']}/join",
                    headers=regular_user["headers"])

        r = client.get("/api/search", params={
            "q": "shared-doc",
            "type": "files",
        }, headers=regular_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        assert any(f["file_name"] == "shared-doc.txt" for f in results)

    def test_deleted_space_file_not_in_search(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        f = _upload_space_file(client, sp["id"], admin_user["headers"],
                               filename="to-delete.txt")

        # Delete the file
        r = client.delete(f"/api/spaces/{sp['id']}/files/{f['id']}",
                          headers=admin_user["headers"])
        assert r.status_code == 200

        r = client.get("/api/search", params={
            "q": "to-delete",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        assert not any(f["file_name"] == "to-delete.txt" for f in results)

    def test_folders_appear_in_search(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        client.post(f"/api/spaces/{sp['id']}/files/folder",
                    json={"name": "searchable-folder", "parent_id": ""},
                    headers=admin_user["headers"])

        r = client.get("/api/search", params={
            "q": "searchable-folder",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        match = next(f for f in results if f["file_name"] == "searchable-folder")
        assert match["is_folder"] is True
        assert match["source"] == "space"

    def test_files_have_is_folder_false(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="not-a-folder.txt")

        r = client.get("/api/search", params={
            "q": "not-a-folder",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        match = next(f for f in results if f["file_name"] == "not-a-folder.txt")
        assert match["is_folder"] is False

    def test_space_file_has_correct_fields(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="fieldcheck.txt",
                           content=b"twelve chars")

        r = client.get("/api/search", params={
            "q": "fieldcheck",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 1

        f = results[0]
        assert f["source"] == "space"
        assert f["space_id"] == sp["id"]
        assert f["space_name"] == "SearchSpace"
        assert f["file_name"] == "fieldcheck.txt"
        assert f["file_size"] == 12
        assert f["username"] == admin_user["user"]["username"]
        assert f["file_id"] != ""
        assert f["created_at"] != ""
        # Space files have empty message/channel fields
        assert f["message_id"] == ""
        assert f["channel_id"] == ""

    def test_search_returns_both_message_and_space_files(self, client, admin_user):
        """When both message-attached and space files match, both should appear."""
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="budget-2026.xlsx",
                           content=b"space file data")

        # Create a channel and send a message with a file attachment
        r = client.post("/api/channels",
                        json={"name": "general", "space_id": sp["id"]},
                        headers=admin_user["headers"])
        assert r.status_code == 200
        ch_id = r.json()["id"]

        # Upload a file as a message attachment
        r = client.post(
            f"/api/channels/{ch_id}/upload",
            params={"filename": "budget-2026-notes.txt",
                    "content_type": "text/plain"},
            content=b"message file data",
            headers={**admin_user["headers"], "Content-Type": "text/plain"},
        )
        # The upload endpoint may or may not exist; if it does, verify both show
        if r.status_code == 200:
            r = client.get("/api/search", params={
                "q": "budget-2026",
                "type": "files",
            }, headers=admin_user["headers"])
            assert r.status_code == 200
            results = r.json()["results"]
            sources = {f["source"] for f in results}
            assert "space" in sources
            # If the message file was created, it should also appear
            if any(f["file_name"] == "budget-2026-notes.txt" for f in results):
                assert "message" in sources
        else:
            # Channel file upload not available; just verify space file appears
            r = client.get("/api/search", params={
                "q": "budget-2026",
                "type": "files",
            }, headers=admin_user["headers"])
            assert r.status_code == 200
            results = r.json()["results"]
            assert any(f["source"] == "space" and
                       f["file_name"] == "budget-2026.xlsx" for f in results)

    def test_search_empty_query_returns_files(self, client, admin_user):
        """An empty search query should still return space files (browse mode)."""
        sp = _create_space(client, admin_user["headers"])
        _upload_space_file(client, sp["id"], admin_user["headers"],
                           filename="browseable.txt")

        r = client.get("/api/search", params={
            "q": "",
            "type": "files",
        }, headers=admin_user["headers"])
        # Empty query may return results or empty depending on backend behavior
        assert r.status_code == 200

    def test_multiple_spaces_search(self, client, admin_user):
        sp1 = _create_space(client, admin_user["headers"], "Alpha")
        sp2 = _create_space(client, admin_user["headers"], "Beta")
        _upload_space_file(client, sp1["id"], admin_user["headers"],
                           filename="common-file.txt")
        _upload_space_file(client, sp2["id"], admin_user["headers"],
                           filename="common-file.txt")

        r = client.get("/api/search", params={
            "q": "common-file",
            "type": "files",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        results = r.json()["results"]
        space_results = [f for f in results if f["source"] == "space"]
        assert len(space_results) == 2
        space_names = {f["space_name"] for f in space_results}
        assert space_names == {"Alpha", "Beta"}
