"""Server-side entry directory.

This is NOT the importable Python package — that's `vrl_yolo` at
`server/vrl_yolo/`, which uv exposes on sys.path so `import vrl_yolo`
works. The `__init__.py` here exists only so `server.main` resolves as
a dotted import for uvicorn's `module:attr` entry-point syntax.

Project-internal code should `import vrl_yolo.…`, never `import server.…`.
"""
