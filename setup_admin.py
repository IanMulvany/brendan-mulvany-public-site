#!/usr/bin/env python3
"""
Setup script for creating the first admin user after deployment.

This script works with local SQLite databases. For Turso/libSQL databases,
use the Turso CLI directly (see VERCEL_DEPLOYMENT.md).

Usage:
    # Local SQLite database (default: ./public_site.db)
    python setup_admin.py
    
    # Specify database path
    python setup_admin.py --db-path "/path/to/public_site.db"
    
    # Non-interactive mode (for scripts)
    python setup_admin.py --username "admin" --email "admin@example.com" --password "secure-password"
"""

import sys
import os
import argparse
import bcrypt
import getpass
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from database import PublicSiteDatabase


def create_admin_user(db: PublicSiteDatabase, username: str, email: str, password: str) -> bool:
    """Create an admin user in the database"""
    # Check if user already exists
    existing = db.get_user_by_username(username)
    if existing:
        print(f"❌ User '{username}' already exists!")
        return False
    
    # Check if any admin users exist
    with db.get_connection() as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = cursor.fetchone()[0]
        if admin_count > 0:
            print(f"⚠️  Warning: {admin_count} admin user(s) already exist(s)")
            response = input("Continue anyway? (y/N): ").strip().lower()
            if response != 'y':
                print("Cancelled.")
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
    print()
    print("Next steps:")
    print("1. Log in via: POST /api/auth/login")
    print("2. Use the JWT token as Bearer token for admin endpoints")
    print("3. Example:")
    print("   curl -X POST https://your-domain.com/api/auth/login \\")
    print("     -H 'Content-Type: application/json' \\")
    print("     -d '{\"username\": \"" + username + "\", \"password\": \"...\"}'")
    return True


def get_db_from_args(args):
    """Get database instance from command line arguments"""
    if args.db_path:
        # Local SQLite database
        db_path = Path(args.db_path)
        if not db_path.exists():
            print(f"⚠️  Database file not found at {db_path}")
            print("   Creating new database...")
        return PublicSiteDatabase(db_path)
    else:
        # Default: local database in current directory
        default_db = Path(__file__).parent / "public_site.db"
        if not default_db.exists():
            print(f"⚠️  Database file not found at {default_db}")
            print("   Creating new database...")
        return PublicSiteDatabase(default_db)


def main():
    parser = argparse.ArgumentParser(
        description="Create the first admin user for the public site",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Interactive mode (default)
  python setup_admin.py
  
  # Specify database path
  python setup_admin.py --db-path /path/to/public_site.db
  
  # Non-interactive mode
  python setup_admin.py --username admin --email admin@example.com --password "secure-password"
  
Note: For Turso/libSQL databases, use Turso CLI directly:
  turso db shell your-db-name
  # Then run SQL INSERT statement (see VERCEL_DEPLOYMENT.md)
        """
    )
    
    parser.add_argument(
        '--db-path',
        type=str,
        help='Path to local SQLite database file (default: ./public_site.db)'
    )
    
    # User creation options
    parser.add_argument(
        '--username',
        type=str,
        help='Admin username (if not provided, will prompt)'
    )
    parser.add_argument(
        '--email',
        type=str,
        help='Admin email (if not provided, will prompt)'
    )
    parser.add_argument(
        '--password',
        type=str,
        help='Admin password (if not provided, will prompt securely)'
    )
    parser.add_argument(
        '--non-interactive',
        action='store_true',
        help='Non-interactive mode (requires --username, --email, --password)'
    )
    
    args = parser.parse_args()
    
    # Validate non-interactive mode
    if args.non_interactive:
        if not (args.username and args.email and args.password):
            print("❌ --non-interactive requires --username, --email, and --password")
            sys.exit(1)
    
    # Get database
    try:
        db = get_db_from_args(args)
    except Exception as e:
        print(f"❌ Failed to connect to database: {e}")
        sys.exit(1)
    
    # Get user credentials
    if args.non_interactive:
        username = args.username
        email = args.email
        password = args.password
    else:
        print("=" * 50)
        print("Create Admin User for Public Site")
        print("=" * 50)
        print()
        
        username = args.username or input("Username: ").strip()
        if not username:
            print("❌ Username is required")
            sys.exit(1)
        
        email = args.email or input("Email: ").strip()
        if not email:
            print("❌ Email is required")
            sys.exit(1)
        
        password = args.password or getpass.getpass("Password: ")
        if not password:
            print("❌ Password is required")
            sys.exit(1)
        
        if not args.password:
            password_confirm = getpass.getpass("Confirm password: ")
            if password != password_confirm:
                print("❌ Passwords do not match")
                sys.exit(1)
        
        print()
    
    # Create admin user
    success = create_admin_user(db, username, email, password)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

