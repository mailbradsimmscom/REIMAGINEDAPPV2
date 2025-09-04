import request from 'supertest';

// App factory to avoid importing during module load
let appInstance = null;

async function getApp() {
  if (!appInstance) {
    const { default: app } = await import('../../src/index.js');
    appInstance = app;
  }
  return appInstance;
}

/**
 * Test helper that returns a Supertest Request object for chaining
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.query - Query parameters
 * @returns {Promise<Object>} Promise that resolves to Supertest Request object
 */
export async function get(path, options = {}) {
  const app = await getApp();
  let req = request(app).get(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.query) {
    req = req.query(options.query);
  }
  
  return req; // Return Request object directly, do NOT await
}

/**
 * Test helper for POST requests
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.body - Request body
 * @returns {Promise<Object>} Promise that resolves to Supertest Request object
 */
export async function post(path, options = {}) {
  const app = await getApp();
  let req = request(app).post(path).set('content-type', 'application/json');
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.body !== undefined) {
    req = req.send(options.body);
  }
  
  return req; // Return Request object directly, do NOT await
}

/**
 * Test helper for PUT requests
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.body - Request body
 * @returns {Promise<Object>} Promise that resolves to Supertest Request object
 */
export async function put(path, options = {}) {
  const app = await getApp();
  let req = request(app).put(path).set('content-type', 'application/json');
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.body !== undefined) {
    req = req.send(options.body);
  }
  
  return req; // Return Request object directly, do NOT await
}

/**
 * Test helper for PATCH requests
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.body - Request body
 * @returns {Promise<Object>} Promise that resolves to Supertest Request object
 */
export async function patch(path, options = {}) {
  const app = await getApp();
  let req = request(app).patch(path).set('content-type', 'application/json');
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.body !== undefined) {
    req = req.send(options.body);
  }
  
  return req; // Return Request object directly, do NOT await
}

/**
 * Test helper for DELETE requests
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.query - Query parameters
 * @returns {Promise<Object>} Promise that resolves to Supertest Request object
 */
export async function del(path, options = {}) {
  const app = await getApp();
  let req = request(app).delete(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.query) {
    req = req.query(options.query);
  }
  
  return req; // Return Request object directly, do NOT await
}
