# Backend
Run with Python 3.11+.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

Demo accounts: `alex`, `sam`, `jordan`, `taylor` — password `signal123`.
