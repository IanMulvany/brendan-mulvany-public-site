#!/bin/bash
# Run the public site server

cd "$(dirname "$0")"
uv run python main.py

