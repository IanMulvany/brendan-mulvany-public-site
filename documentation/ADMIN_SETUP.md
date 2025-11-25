Creating a guide for creating an admin account and getting a JWT token:


[1 tool called]


Create a new file `ADMIN_SETUP.md` with this content:

```markdown:ADMIN_SETUP.md
# Admin Account Setup Guide

Complete guide for creating an admin user account and obtaining a JWT token for syncing data to your deployed public site.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Creating Admin User via Turso CLI](#creating-admin-user-via-turso-cli)
3. [Getting JWT Token](#getting-jwt-token)
4. [Using JWT Token for Sync Operations](#using-jwt-token-for-sync-operations)
5. [Troubleshooting](#troubleshooting)
6. [Quick Reference](#quick-reference)

---

## Prerequisites

- Turso CLI installed and authenticated (`turso auth login`)
- Access to your Turso database (database name, typically `public-site-db`)
- Your production site URL (e.g., `https://www.brendan-mulvany-photography.com`)
- Python 3 installed (for generating password hashes)

---

## Creating Admin User via Turso CLI

Since your production database is hosted on Turso, you'll create the admin user directly via SQL.

### Option A: Step-by-Step (Recommended)

**Step 1: Generate Password Hash**

Run this Python command to generate a bcrypt hash for your password:

```bash
python3 -c "
import bcrypt
password = input('Enter password: ')
password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
print('Password hash:', password_hash)
"
```

**Important:** Copy the entire hash output (it will start with `$2b$12$...`). You'll need this in the next step.

**Step 2: Connect to Turso Database**

```bash
turso db shell public-site-db
```

Replace `public-site-db` with your actual database name if different.

**Step 3: Insert Admin User**

Run this SQL command in the Turso shell, replacing the placeholders:

```sql
INSERT INTO users (username, email, password_hash, role)
VALUES (
  'admin',
  'your@email.com',
  '$2b$12$...paste-your-hash-here...',
  'admin'
);
```

**Replace:**
- `'admin'` - Your desired username
- `'your@email.com'` - Your email address
- `'$2b$12$...paste-your-hash-here...'` - The password hash from Step 1

**Step 4: Verify User Was Created**

```sql
SELECT id, username, email, role FROM users WHERE username = 'admin';
```

You should see your newly created admin user.

**Step 5: Exit Turso Shell**

```sql
.exit
```

### Option B: One-Liner (Alternative)

If you prefer a single command:

```bash
python3 -c "
import bcrypt
import sys
password = sys.argv[1]
email = sys.argv[2]
username = sys.argv[3]
hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
print('INSERT INTO users (username, email, password_hash, role) VALUES (\"' + username + '\", \"' + email + '\", \"' + hash + '\", \"admin\");')
" "your-password" "your@email.com" "admin" | turso db shell public-site-db
```

**Replace:**
- `"your-password"` - Your desired password
- `"your@email.com"` - Your email address
- `"admin"` - Your desired username

---

## Getting JWT Token

After creating the admin user, log in to get your JWT token.

### Login Request

```bash
curl -X POST https://www.brendan-mulvany-photography.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-password"
  }'
```

**Replace:**
- `https://www.brendan-mulvany-photography.com` - Your production site URL
- `"admin"` - The username you created
- `"your-password"` - The password you used

### Expected Response

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzI5NTMwNDM1fQ...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "your@email.com",
    "role": "admin"
  }
}
```

**Important:** Copy the `token` value - this is your JWT token that you'll use for authenticated requests.

### Storing Token for Convenience

You can store the token in an environment variable:

```bash
# Get token and store it
export JWT_TOKEN=$(curl -s -X POST https://www.brendan-mulvany-photography.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' | jq -r '.token')

# Verify it's set
echo $JWT_TOKEN
```

**Note:** Requires `jq` for JSON parsing. Without `jq`, manually copy the token from the response.

---

## Using JWT Token for Sync Operations

All admin endpoints require the JWT token as a Bearer token in the Authorization header.

### Basic Usage Pattern

```bash
curl -X METHOD https://your-domain.com/api/admin/endpoint \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Example: Check Sync Status

```bash
curl -X GET https://www.brendan-mulvany-photography.com/api/admin/sync/status \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Example: Sync Data

```bash
curl -X POST https://www.brendan-mulvany-photography.com/api/admin/sync/data \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scenes": [...],
    "dry_run": false
  }'
```

### Token Expiration

**JWT tokens expire after 24 hours.** When your token expires:

1. You'll receive a `401 Unauthorized` error
2. Log in again using `/api/auth/login` to get a new token
3. Update your `JWT_TOKEN` environment variable or use the new token directly

---

## Troubleshooting

### "User already exists" Error

If you try to create a user that already exists:

```sql
-- Check existing users
SELECT id, username, email, role FROM users;

-- Delete existing user (if needed)
DELETE FROM users WHERE username = 'admin';

-- Then create again
```

### "Invalid credentials" on Login

- Verify the username and password match what you inserted
- Check that the password hash was copied correctly (no extra spaces)
- Ensure the user has `role = 'admin'`

### "Invalid or expired token" Error

- Your token has expired (24 hours)
- Log in again to get a new token
- Verify you're using the correct token (no extra spaces or quotes)

### Database Connection Issues

If `turso db shell` fails:

```bash
# Verify you're logged in
turso auth whoami

# List your databases
turso db list

# Verify database name
turso db show public-site-db
```

### Password Hash Generation Issues

If Python bcrypt import fails:

```bash
# Install bcrypt
pip install bcrypt

# Or using uv
uv pip install bcrypt
```

---

## Quick Reference

### Complete Workflow

```bash
# 1. Generate password hash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"

# 2. Connect to database
turso db shell public-site-db

# 3. Insert admin user (in Turso shell)
INSERT INTO users (username, email, password_hash, role) 
VALUES ('admin', 'your@email.com', 'HASH_FROM_STEP_1', 'admin');

# 4. Verify user
SELECT id, username, email, role FROM users WHERE username = 'admin';

# 5. Exit shell
.exit

# 6. Get JWT token
curl -X POST https://www.brendan-mulvany-photography.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# 7. Store token
export JWT_TOKEN="your-token-from-step-6"

# 8. Test admin endpoint
curl -H "Authorization: Bearer $JWT_TOKEN" \
  https://www.brendan-mulvany-photography.com/api/admin/sync/status
```

### Common Commands

```bash
# Check if user exists
turso db shell public-site-db -c "SELECT username, email, role FROM users;"

# Delete user (if needed)
turso db shell public-site-db -c "DELETE FROM users WHERE username = 'admin';"

# Get new token
export JWT_TOKEN=$(curl -s -X POST https://www.brendan-mulvany-photography.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' | jq -r '.token')
```

---

## Security Best Practices

1. **Use Strong Passwords**: Generate a secure, random password for your admin account
2. **Don't Commit Credentials**: Never commit passwords or tokens to version control
3. **Rotate Tokens**: Log in again periodically to get fresh tokens
4. **Limit Admin Access**: Only create admin users for trusted accounts
5. **Monitor Access**: Check Vercel logs for suspicious activity
6. **Rotate JWT Secret**: If compromised, update `CONFIG_JSON` in Vercel with a new `jwt_secret`

---

## Next Steps

After setting up your admin account:

1. ✅ Test sync endpoints with your JWT token
2. ✅ Perform a trial sync with `dry_run: true`
3. ✅ Verify data appears correctly on the public site
4. ✅ Set up automated sync workflows (if needed)

For more information, see:
- [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) - Full deployment guide
- [SYNC_GUIDE.md](./SYNC_GUIDE.md) - Detailed sync operations guide
```

Save this as `ADMIN_SETUP.md` in your project root. It covers creating an admin account via Turso CLI, getting a JWT token, and using it for sync operations.