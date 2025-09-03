import request from 'supertest';

/**
 * Test helper that returns a Supertest Request object for chaining
 * @param {Object} app - Express app instance
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.query - Query parameters
 * @returns {Object} Supertest Request object
 */
export function get(app, path, options = {}) {
  let req = request(app).get(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.query) {
    req = req.query(options.query);
  }
  
  return req;
}

/**
 * Test helper for POST requests
 * @param {Object} app - Express app instance
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.body - Request body
 * @returns {Object} Supertest Request object
 */
export function post(app, path, options = {}) {
  let req = request(app).post(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.body) {
    req = req.send(options.body);
  }
  
  return req;
}

/**
 * Test helper for PUT requests
 * @param {Object} app - Express app instance
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.body - Request body
 * @returns {Object} Supertest Request object
 */
export function put(app, path, options = {}) {
  let req = request(app).put(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.body) {
    req = req.send(options.body);
  }
  
  return req;
}

/**
 * Test helper for DELETE requests
 * @param {Object} app - Express app instance
 * @param {string} path - Request path
 * @param {Object} options - Request options
 * @param {string} options.token - Admin token for x-admin-token header
 * @param {Object} options.query - Query parameters
 * @returns {Object} Supertest Request object
 */
export function del(app, path, options = {}) {
  let req = request(app).delete(path);
  
  if (options.token) {
    req = req.set('x-admin-token', options.token);
  }
  
  if (options.query) {
    req = req.query(options.query);
  }
  
  return req;
}
