from database import create_connection, get_db

def test_create_connection(tmp_path):
    db_file = str(tmp_path / "test.db")
    conn = create_connection(db_file)
    assert conn is not None
    
    # Test that we can execute queries
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE test_table (id INTEGER PRIMARY KEY, value TEXT)")
    cursor.execute("INSERT INTO test_table (value) VALUES (?)", ("hello",))
    conn.commit()
    
    cursor.execute("SELECT value FROM test_table WHERE id = 1")
    row = cursor.fetchone()
    assert row is not None
    assert row["value"] == "hello"

def test_get_db(tmp_path):
    db_file = str(tmp_path / "test.db")
    # Test context manager
    with get_db(db_file) as conn:
        assert conn is not None
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS test_table2 (id INTEGER PRIMARY KEY, value TEXT)")
        cursor.execute("INSERT INTO test_table2 (value) VALUES (?)", ("world",))
        # Context manager does not commit automatically
        conn.commit()
        
    with get_db(db_file) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM test_table2 WHERE id = 1")
        row = cursor.fetchone()
        assert row is not None
        assert row["value"] == "world"
