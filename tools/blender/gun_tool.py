"""Shortcut: gun_tool.py has been extended into asset_tool.py (same old modes)."""
import runpy, os
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "asset_tool.py"), run_name="__main__")
