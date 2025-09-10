import { logger } from '../utils/logger.js';

/**
 * Security middleware - adds essential security headers
 * Equivalent to Helmet.js but lightweight and customized
 */
export function securityHeaders(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Content Security Policy - restrict resource loading
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  
  // X-Frame-Options - prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // X-Content-Type-Options - prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // X-XSS-Protection - enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy - control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy - control browser features
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  requestLogger.debug('Security headers applied', { url: req.url });
  next();
}

/**
 * Rate limiting middleware (basic implementation)
 * In production, consider using express-rate-limit
 */
export function basicRateLimit(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Simple rate limiting - track requests per IP
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 500; // 500 requests per window
  
  // Initialize rate limit tracking if not exists
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const rateLimit = req.app.locals.rateLimit;
  const clientData = rateLimit.get(clientIP) || { count: 0, resetTime: now + windowMs };
  
  // Reset if window has passed
  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + windowMs;
  }
  
  // Check if limit exceeded
  if (clientData.count >= maxRequests) {
    requestLogger.warn('Rate limit exceeded', { 
      ip: clientIP, 
      url: req.url,
      count: clientData.count 
    });
    
    return res.status(429).json({
      success: false,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests, please try again later'
    });
  }
  
  // Increment counter
  clientData.count++;
  rateLimit.set(clientIP, clientData);
  
  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', maxRequests - clientData.count);
  res.setHeader('X-RateLimit-Reset', new Date(clientData.resetTime).toISOString());
  
  next();
}
