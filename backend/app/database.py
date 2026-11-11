import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./signal_clone.db")
database_url = make_url(DATABASE_URL)
if database_url.drivername in ("postgres", "postgresql"):
    database_url = database_url.set(drivername="postgresql+psycopg")

engine_options = {"pool_pre_ping": True}
if database_url.drivername == "sqlite":
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

def initialize_database():
    Base.metadata.create_all(bind=engine)
    columns_to_add = {
        "conversations": {
            "created_by": "INTEGER REFERENCES users(id)",
            "description": "VARCHAR(500)",
            "avatar_url": "VARCHAR(500)",
        },
        "conversation_members": {
            "last_read_at": "TIMESTAMP WITH TIME ZONE",
        },
    }
    with engine.begin() as connection:
        inspector = inspect(connection)
        for table_name, columns in columns_to_add.items():
            existing = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_type in columns.items():
                if column_name not in existing:
                    connection.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    ))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
