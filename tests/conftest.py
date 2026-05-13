import os

def pytest_configure(config):
    os.environ["VOXLY_SKIP_AUTOCREATE"] = "1"
    os.environ["VOXLY_JWT_SECRET"] = "test-secret"
