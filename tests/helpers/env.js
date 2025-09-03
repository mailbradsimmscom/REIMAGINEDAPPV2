import { getEnv } from '../../src/config/env.js';

export function testEnv() { 
  return getEnv({ loose: true }); 
}
