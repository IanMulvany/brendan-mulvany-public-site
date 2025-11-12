"""
Vercel serverless function handler for FastAPI app
"""
import sys
from pathlib import Path

# Add the parent directory to Python path for imports
CURRENT_DIR = Path(__file__).parent
PARENT_DIR = CURRENT_DIR.parent
sys.path.insert(0, str(PARENT_DIR))
sys.path.insert(0, str(CURRENT_DIR))

# Import the FastAPI app
from main import app

# Export the app for Vercel (Vercel auto-detects FastAPI apps)
# No need to assign to handler - just export app directly

