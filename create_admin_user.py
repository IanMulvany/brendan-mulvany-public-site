#!/usr/bin/env python3
"""
Create an admin user for the public site
"""

import sys
from pathlib import Path
import bcrypt
import getpass

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from database import PublicSiteDatabase

# Database path
PUBLIC_DB = Path(__file__).parent / "public_site.db"

def create_admin_user(username: str, email: str, password: str):
    """Create an admin user in the database"""
    db = PublicSiteDatabase(PUBLIC_DB)
    
    # Check if user already exists
    existing = db.get_user_by_username(username)
    if existing:
        print(f"❌ User '{username}' already exists!")
        return False
    
    # Hash password
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # Create user with admin role
    user_id = db.create_user(username, email, password_hash, role='admin')
    
    print(f"✅ Admin user created successfully!")
    print(f"   Username: {username}")
    print(f"   Email: {email}")
    print(f"   Role: admin")
    print(f"   User ID: {user_id}")
    return True

if __name__ == "__main__":
    print("=" * 50)
    print("Create Admin User for Public Site")
    print("=" * 50)
    print()
    
    # Get username
    username = input("Username: ").strip()
    if not username:
        print("❌ Username is required")
        sys.exit(1)
    
    # Get email
    email = input("Email: ").strip()
    if not email:
        print("❌ Email is required")
        sys.exit(1)
    
    # Get password (hidden)
    password = getpass.getpass("Password: ")
    if not password:
        print("❌ Password is required")
        sys.exit(1)
    
    password_confirm = getpass.getpass("Confirm password: ")
    if password != password_confirm:
        print("❌ Passwords do not match")
        sys.exit(1)
    
    print()
    create_admin_user(username, email, password)

