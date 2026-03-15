"""Tests for task board endpoints: boards, columns, tasks, labels, checklists,
dependencies, and permissions."""

from conftest import pki_register, auth_header


def _create_space(client, headers, name="TestSpace"):
    """Helper to create a space and enable the tasks tool."""
    r = client.post("/api/spaces", json={"name": name}, headers=headers)
    assert r.status_code == 200
    sp = r.json()
    client.put(f"/api/spaces/{sp['id']}/tools",
               json={"tool": "tasks", "enabled": True}, headers=headers)
    return sp


def _add_member_with_role(client, space_id, admin_headers, user_info, role):
    """Invite a user to a space and accept the invite."""
    r = client.post(f"/api/spaces/{space_id}/members",
                    json={"user_id": user_info["user"]["id"], "role": role},
                    headers=admin_headers)
    assert r.status_code == 200
    r = client.get("/api/space-invites", headers=user_info["headers"])
    assert r.status_code == 200
    invites = r.json()
    invite = next(i for i in invites if i["space_id"] == space_id)
    r = client.post(f"/api/space-invites/{invite['id']}/accept",
                    headers=user_info["headers"])
    assert r.status_code == 200


def _create_board(client, space_id, headers, name="Test Board", **kwargs):
    body = {"name": name, **kwargs}
    return client.post(f"/api/spaces/{space_id}/tasks/boards",
                       json=body, headers=headers)


def _create_task(client, space_id, board_id, column_id, headers,
                 title="Test Task", **kwargs):
    body = {"column_id": column_id, "title": title, **kwargs}
    return client.post(f"/api/spaces/{space_id}/tasks/boards/{board_id}/tasks",
                       json=body, headers=headers)


class TestBoardCRUD:
    def test_create_board(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"],
                          name="Sprint 1", description="First sprint")
        assert r.status_code == 200
        board = r.json()
        assert board["name"] == "Sprint 1"
        assert board["description"] == "First sprint"
        assert "id" in board
        # Default columns should be created
        assert len(board["columns"]) == 3

    def test_list_boards(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        _create_board(client, sp["id"], admin_user["headers"], name="Board A")
        _create_board(client, sp["id"], admin_user["headers"], name="Board B")

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert len(data["boards"]) == 2
        assert "my_permission" in data

    def test_get_board_with_tasks(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        _create_task(client, sp["id"], board["id"], col_id,
                     admin_user["headers"], title="Task 1")

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert len(data["columns"]) == 3
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["title"] == "Task 1"
        assert "board_labels" in data
        assert "dependencies" in data

    def test_update_board(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board_id = r.json()["id"]

        r = client.put(f"/api/spaces/{sp['id']}/tasks/boards/{board_id}",
                       json={"name": "Renamed", "description": "updated"},
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed"

    def test_delete_board(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board_id = r.json()["id"]

        r = client.delete(f"/api/spaces/{sp['id']}/tasks/boards/{board_id}",
                          headers=admin_user["headers"])
        assert r.status_code == 200

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=admin_user["headers"])
        assert len(r.json()["boards"]) == 0

    def test_board_not_found(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = client.get(
            f"/api/spaces/{sp['id']}/tasks/boards/00000000-0000-0000-0000-000000000000",
            headers=admin_user["headers"])
        assert r.status_code == 404

    def test_non_member_cannot_access(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"], "Private")
        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=regular_user["headers"])
        assert r.status_code == 403

    def test_empty_name_rejected(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"], name="")
        assert r.status_code == 400


class TestColumnCRUD:
    def test_create_column(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board_id = r.json()["id"]

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board_id}/columns",
            json={"name": "Review", "position": 3, "wip_limit": 2},
            headers=admin_user["headers"])
        assert r.status_code == 200
        col = r.json()
        assert col["name"] == "Review"
        assert col["wip_limit"] == 2

    def test_update_column(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/columns/{col_id}",
            json={"name": "Renamed", "wip_limit": 5},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed"
        assert r.json()["wip_limit"] == 5

    def test_reorder_columns(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_ids = [c["id"] for c in board["columns"]]

        # Reverse order
        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/columns/reorder",
            json={"column_ids": list(reversed(col_ids))},
            headers=admin_user["headers"])
        assert r.status_code == 200

    def test_delete_empty_column(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        # Add a new column (the default ones might have tasks)
        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/columns",
            json={"name": "Temp", "position": 99},
            headers=admin_user["headers"])
        col_id = r.json()["id"]

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/columns/{col_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200

    def test_delete_column_with_tasks_rejected(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        _create_task(client, sp["id"], board["id"], col_id,
                     admin_user["headers"])

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/columns/{col_id}",
            headers=admin_user["headers"])
        assert r.status_code == 400


class TestTaskCRUD:
    def test_create_task(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], title="My Task",
                         description="Do something", priority="high")
        assert r.status_code == 200
        task = r.json()
        assert task["title"] == "My Task"
        assert task["priority"] == "high"
        assert "assignees" in task
        assert "labels" in task

    def test_create_task_with_gantt_fields(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], title="Gantt Task",
                         start_date="2026-04-01T00:00:00Z",
                         duration_days=5)
        assert r.status_code == 200
        task = r.json()
        assert task["duration_days"] == 5
        assert "2026-04-01" in task["start_date"]

    def test_get_task_detail(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.get(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "checklists" in data
        assert "activity" in data
        assert "my_permission" in data

    def test_update_task(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], title="Old")
        task_id = r.json()["id"]

        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            json={"title": "New", "priority": "critical",
                  "start_date": "2026-05-01T00:00:00Z", "duration_days": 10},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["title"] == "New"
        assert r.json()["priority"] == "critical"
        assert r.json()["duration_days"] == 10

    def test_move_task_between_columns(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col1_id = board["columns"][0]["id"]
        col2_id = board["columns"][1]["id"]

        r = _create_task(client, sp["id"], board["id"], col1_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            json={"column_id": col2_id},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["column_id"] == col2_id

    def test_delete_task(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200

    def test_empty_title_rejected(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], title="")
        assert r.status_code == 400

    def test_reorder_tasks(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r1 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="A", position=0)
        r2 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="B", position=1)

        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/reorder",
            json={"tasks": [
                {"id": r2.json()["id"], "column_id": col_id, "position": 0},
                {"id": r1.json()["id"], "column_id": col_id, "position": 1},
            ]},
            headers=admin_user["headers"])
        assert r.status_code == 200


class TestTaskAssigneesAndLabels:
    def test_create_task_with_assignees(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"],
                         assignee_ids=[admin_user["user"]["id"]])
        assert r.status_code == 200
        assert len(r.json()["assignees"]) == 1

    def test_update_assignees(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        client.post(f"/api/spaces/{sp['id']}/join",
                    headers=regular_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            json={"assignee_ids": [admin_user["user"]["id"],
                                    regular_user["user"]["id"]]},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()["assignees"]) == 2

    def test_create_and_assign_label(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        # Create a label
        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/labels",
            json={"name": "Bug", "color": "#ef4444"},
            headers=admin_user["headers"])
        assert r.status_code == 200
        label_id = r.json()["id"]

        # Create task with label
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], label_ids=[label_id])
        assert r.status_code == 200
        assert len(r.json()["labels"]) == 1
        assert r.json()["labels"][0]["name"] == "Bug"

    def test_delete_label(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/labels",
            json={"name": "Temp", "color": "#888"},
            headers=admin_user["headers"])
        label_id = r.json()["id"]

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/labels/{label_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200


class TestTaskChecklists:
    def test_create_checklist(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists",
            json={"title": "Pre-deploy"},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["title"] == "Pre-deploy"
        assert "items" in r.json()

    def test_add_and_toggle_checklist_item(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists",
            json={"title": "Steps"},
            headers=admin_user["headers"])
        cl_id = r.json()["id"]

        # Add item
        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists/{cl_id}/items",
            json={"content": "Step 1"},
            headers=admin_user["headers"])
        assert r.status_code == 200
        item_id = r.json()["id"]
        assert r.json()["is_checked"] is False

        # Toggle item
        r = client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists/{cl_id}/items/{item_id}",
            json={"content": "Step 1", "is_checked": True},
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["is_checked"] is True

    def test_checklists_in_task_detail(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        # Create checklist with item
        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists",
            json={"title": "List"},
            headers=admin_user["headers"])
        cl_id = r.json()["id"]
        client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}/checklists/{cl_id}/items",
            json={"content": "Item 1"},
            headers=admin_user["headers"])

        # Get detail
        r = client.get(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()["checklists"]) == 1
        assert len(r.json()["checklists"][0]["items"]) == 1


class TestTaskDependencies:
    def test_add_dependency(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r1 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="Prerequisite")
        r2 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="Dependent")

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/dependencies",
            json={"task_id": r2.json()["id"],
                  "depends_on_id": r1.json()["id"],
                  "dependency_type": "finish_to_start"},
            headers=admin_user["headers"])
        assert r.status_code == 200
        dep = r.json()
        assert dep["task_id"] == r2.json()["id"]
        assert dep["depends_on_id"] == r1.json()["id"]

    def test_dependencies_in_board_response(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r1 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="T1")
        r2 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"], title="T2")

        client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/dependencies",
            json={"task_id": r2.json()["id"],
                  "depends_on_id": r1.json()["id"]},
            headers=admin_user["headers"])

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()["dependencies"]) == 1

    def test_remove_dependency(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r1 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"])
        r2 = _create_task(client, sp["id"], board["id"], col_id,
                          admin_user["headers"])

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/dependencies",
            json={"task_id": r2.json()["id"],
                  "depends_on_id": r1.json()["id"]},
            headers=admin_user["headers"])
        dep_id = r.json()["id"]

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/dependencies/{dep_id}",
            headers=admin_user["headers"])
        assert r.status_code == 200


class TestTaskActivity:
    def test_activity_logged_on_create(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]
        r = _create_task(client, sp["id"], board["id"], col_id,
                         admin_user["headers"], title="Tracked")
        task_id = r.json()["id"]

        r = client.get(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            headers=admin_user["headers"])
        activity = r.json()["activity"]
        assert len(activity) >= 1
        assert activity[0]["action"] == "created"

    def test_activity_logged_on_move(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col1_id = board["columns"][0]["id"]
        col2_id = board["columns"][1]["id"]

        r = _create_task(client, sp["id"], board["id"], col1_id,
                         admin_user["headers"])
        task_id = r.json()["id"]

        client.put(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            json={"column_id": col2_id},
            headers=admin_user["headers"])

        r = client.get(
            f"/api/spaces/{sp['id']}/tasks/boards/{board['id']}/tasks/{task_id}",
            headers=admin_user["headers"])
        actions = [a["action"] for a in r.json()["activity"]]
        assert "moved" in actions


class TestTaskPermissions:
    def test_owner_gets_owner_permission(self, client, admin_user):
        sp = _create_space(client, admin_user["headers"])
        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["my_permission"] == "owner"

    def test_user_member_gets_view(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        client.post(f"/api/spaces/{sp['id']}/join",
                    headers=regular_user["headers"])

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=regular_user["headers"])
        assert r.status_code == 200
        assert r.json()["my_permission"] == "view"

    def test_view_user_cannot_create_board(self, client, admin_user,
                                            regular_user):
        sp = _create_space(client, admin_user["headers"])
        _add_member_with_role(client, sp["id"], admin_user["headers"],
                              regular_user, "user")

        r = _create_board(client, sp["id"], regular_user["headers"])
        assert r.status_code == 403

    def test_view_user_cannot_create_task(self, client, admin_user,
                                           regular_user):
        sp = _create_space(client, admin_user["headers"])
        _add_member_with_role(client, sp["id"], admin_user["headers"],
                              regular_user, "user")

        r = _create_board(client, sp["id"], admin_user["headers"])
        board = r.json()
        col_id = board["columns"][0]["id"]

        r = _create_task(client, sp["id"], board["id"], col_id,
                         regular_user["headers"])
        assert r.status_code == 403

    def test_permission_escalation(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        _add_member_with_role(client, sp["id"], admin_user["headers"],
                              regular_user, "user")

        # Without escalation: view
        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=regular_user["headers"])
        assert r.json()["my_permission"] == "view"

        # Escalate
        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/permissions",
            json={"user_id": regular_user["user"]["id"],
                  "permission": "edit"},
            headers=admin_user["headers"])
        assert r.status_code == 200

        # Now should have edit
        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=regular_user["headers"])
        assert r.json()["my_permission"] == "edit"

    def test_get_permissions(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        _add_member_with_role(client, sp["id"], admin_user["headers"],
                              regular_user, "user")
        client.post(
            f"/api/spaces/{sp['id']}/tasks/permissions",
            json={"user_id": regular_user["user"]["id"],
                  "permission": "edit"},
            headers=admin_user["headers"])

        r = client.get(f"/api/spaces/{sp['id']}/tasks/permissions",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()["permissions"]) == 1

    def test_remove_permission(self, client, admin_user, regular_user):
        sp = _create_space(client, admin_user["headers"])
        _add_member_with_role(client, sp["id"], admin_user["headers"],
                              regular_user, "user")
        client.post(
            f"/api/spaces/{sp['id']}/tasks/permissions",
            json={"user_id": regular_user["user"]["id"],
                  "permission": "edit"},
            headers=admin_user["headers"])

        r = client.delete(
            f"/api/spaces/{sp['id']}/tasks/permissions/{regular_user['user']['id']}",
            headers=admin_user["headers"])
        assert r.status_code == 200

        r = client.get(f"/api/spaces/{sp['id']}/tasks/boards",
                       headers=regular_user["headers"])
        assert r.json()["my_permission"] == "view"

    def test_non_owner_cannot_set_permissions(self, client, admin_user,
                                               regular_user):
        sp = _create_space(client, admin_user["headers"])
        client.post(f"/api/spaces/{sp['id']}/join",
                    headers=regular_user["headers"])

        r = client.post(
            f"/api/spaces/{sp['id']}/tasks/permissions",
            json={"user_id": admin_user["user"]["id"],
                  "permission": "view"},
            headers=regular_user["headers"])
        assert r.status_code == 403
