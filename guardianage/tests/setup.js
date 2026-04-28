/**
 * Guardianage Test Setup
 * Provides supertest helpers with session cookie management.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { getAppSync, initTestApp } from '../../tests/setupApp.js';

let adminCookie = null;
let teamCookie = null;

/**
 * Make a request to the guardianage API with optional session cookie.
 */
function guardianageRequest(method, path, cookie = null) {
  const app = getAppSync();
  const req = request(app)[method](`/guardianage${path}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/**
 * Login as the admin user (brad/admin) and cache the session cookie.
 */
async function loginAsAdmin() {
  if (adminCookie) return adminCookie;
  const app = getAppSync();
  const res = await request(app)
    .post('/guardianage/api/auth/login')
    .send({ login_id: 'brad', password: 'admin' });

  if (res.status !== 200 || !res.body.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(res.body)}`);
  }

  const setCookie = res.headers['set-cookie'];
  adminCookie = setCookie?.find(c => c.startsWith('guardianage_session='));
  if (!adminCookie) throw new Error('No session cookie returned from login');
  return adminCookie;
}

/**
 * Create a team user and login, caching the session cookie.
 * Requires admin to be logged in first.
 */
async function loginAsTeamUser() {
  if (teamCookie) return teamCookie;

  const admin = await loginAsAdmin();
  const app = getAppSync();

  // Create test team user (ignore if already exists)
  await request(app)
    .post('/guardianage/api/admin/users')
    .set('Cookie', admin)
    .send({
      login_id: 'test_team',
      password: 'test1234',
      display_name: 'Test Team User',
      role: 'team_user',
    });

  // Login as team user
  const res = await request(app)
    .post('/guardianage/api/auth/login')
    .send({ login_id: 'test_team', password: 'test1234' });

  if (res.status !== 200 || !res.body.success) {
    throw new Error(`Team user login failed: ${JSON.stringify(res.body)}`);
  }

  const setCookie = res.headers['set-cookie'];
  teamCookie = setCookie?.find(c => c.startsWith('guardianage_session='));
  if (!teamCookie) throw new Error('No session cookie returned from team login');
  return teamCookie;
}

export {
  test,
  assert,
  request,
  initTestApp,
  guardianageRequest,
  loginAsAdmin,
  loginAsTeamUser,
};
