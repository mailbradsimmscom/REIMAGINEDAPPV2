import request from 'supertest';
import { getAppSync } from '../setupApp.js';

const withToken = (r, token) => {
  if (!token) return r;
  return r.set('x-admin-token', token); // your suite can also add Bearer if you want
};

export function get(path, { token, query } = {}) {
  let r = request(getAppSync()).get(path);
  if (token) r = withToken(r, token);
  if (query) r = r.query(query);
  return r; // <-- Request (chain .expect/.query)
}

export function del(path, { token, query } = {}) {
  let r = request(getAppSync()).delete(path);
  if (token) r = withToken(r, token);
  if (query) r = r.query(query);
  return r;
}

export function post(path, { token, body } = {}) {
  let r = request(getAppSync()).post(path).set('content-type', 'application/json');
  if (token) r = withToken(r, token);
  if (body !== undefined) r = r.send(body);
  return r; // <-- Request (chain .expect/.send)
}

export function put(path, { token, body } = {}) {
  let r = request(getAppSync()).put(path).set('content-type', 'application/json');
  if (token) r = withToken(r, token);
  if (body !== undefined) r = r.send(body);
  return r;
}

export function patch(path, { token, body } = {}) {
  let r = request(getAppSync()).patch(path).set('content-type', 'application/json');
  if (token) r = withToken(r, token);
  if (body !== undefined) r = r.send(body);
  return r;
}

// Enhanced publicRequest function that properly handles bodies for all methods
export function publicRequest(app, {
  method = 'GET',
  url = '/',
  headers = {},
  query = undefined,
  body = undefined,
} = {}) {
  const m = method.toLowerCase();
  let r = request(app)[m](url);

  if (query) r = r.query(query);
  Object.entries(headers).forEach(([k,v]) => r = r.set(k, v));

  // Ensure JSON bodies are encoded for methods that support them
  const methodsWithBody = new Set(['post','put','patch','delete']);
  if (methodsWithBody.has(m) && body !== undefined) {
    r = r.set('Content-Type', 'application/json').send(body);
  }
  return r;
}

// Convenience function that uses the test app directly
export function testRequest({
  method = 'GET',
  url = '/',
  headers = {},
  query = undefined,
  body = undefined,
} = {}) {
  return publicRequest(getAppSync(), { method, url, headers, query, body });
}
