import os
import json
from database import create_connection

def migrate():
    json_path = "budgets.json"
    if not os.path.exists(json_path):
        print("budgets.json does not exist. Nothing to migrate.")
        return

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print(f"Failed to read budgets.json: {exc}")
        return

    # Assume budgets.json is a dict of {category: limit} or {user_id: {category: limit}} or similar.
    # Let's seed default test user or handle a flat dictionary of {category: limit} by attributing to a default system/test user.
    # If it is a dictionary of {category: limit}, we attribute it to "test-user-id" or similar default.
    with create_connection() as conn:
        # Check users in DB to get a valid user_id
        cur = conn.execute("SELECT id FROM users LIMIT 1")
        row = cur.fetchone()
        user_id = row["id"] if row else "default-user-id"

        for category, limit_val in data.items():
            if isinstance(limit_val, dict):
                # {user_id: {category: limit}} format
                u_id = category
                for cat, l in limit_val.items():
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO user_budgets (user_id, category, monthly_limit, warn_at)
                        VALUES (?, ?, ?, 0.8)
                        """,
                        (u_id, cat.lower().strip(), float(l))
                    )
            else:
                # Flat format {category: limit}
                conn.execute(
                    """
                    INSERT OR REPLACE INTO user_budgets (user_id, category, monthly_limit, warn_at)
                    VALUES (?, ?, ?, 0.8)
                    """,
                    (user_id, category.lower().strip(), float(limit_val))
                )
        conn.commit()
    print("Migration from budgets.json completed successfully.")
    try:
        os.remove(json_path)
        print("Deleted budgets.json.")
    except Exception as exc:
        print(f"Failed to delete budgets.json: {exc}")

if __name__ == "__main__":
    migrate()
